import { useEffect, useRef, useState } from "react";
import { useSettings } from "../../settings/SettingsContext";
import { isMagicDiary } from "../../theme/builtin-themes";
import {
  orbitLength,
  orbitPoint,
  STEP_MS,
  STRIDE,
  stepToward,
  WALKER_ARRIVED_EVENT,
  type Point,
} from "./footprint-gait";
import {
  advanceEncounter,
  createEncounter,
  type Encounter,
} from "./map-encounters";
import {
  chooseLandmark,
  type LandmarkVisit,
  type LandmarkTarget,
} from "./map-landmarks";
import { MapLandmarks, VisitorGlyph } from "./MagicMapOrnaments";
import { MAGIC_DIARY_EVENT, type MagicDiaryEvent } from "./magic-diary-plugin";

interface Foot {
  id: number;
  x: number;
  y: number;
  heading: number;
  right: boolean;
}
type Stage =
  | "orbit"
  | "approach"
  | "standing"
  | "leaving"
  | "encounter"
  | "visiting"
  | "landmark"
  | "returning";
interface VisitorDrawing {
  encounter: Encounter;
  point: Point;
  hero: Point;
  feet: Foot[];
}

function FootGlyph() {
  return (
    <svg viewBox="0 0 24 12" width="19" height="10">
      <path d="M2 5c0-2 2-3 5-2l4 1c2 0 3-2 6-1 3 1 3 4 0 5-3 1-5-1-7 0-4 2-8 0-8-3Z" />
      <ellipse cx="20.5" cy="2.5" rx="2" ry="1.5" />
      <circle cx="17" cy="1.5" r="1.2" />
      <circle cx="14.3" cy="1.2" r="1" />
      <circle cx="12" cy="1.5" r=".8" />
    </svg>
  );
}
const VISITOR_NAMES = {
  wanderer: ["掌灯人", "Lamplighter"],
  wisp: ["纸上星火", "Paper wisp"],
  beast: ["墨影狼", "Ink wolf"],
} as const;

/** One walker owns both the perimeter and the journey to the ink. Each
 * footfall is stamped once; only its fading trail remains on the paper. */
export function FootprintLayer() {
  const { settings } = useSettings();
  const on = isMagicDiary(settings);
  const [feet, setFeet] = useState<Foot[]>([]);
  const [stage, setStage] = useState<Stage>("orbit");
  const [visitorDrawing, setVisitorDrawing] = useState<VisitorDrawing | null>(
    null,
  );
  const [landmarkVisit, setLandmarkVisit] = useState<LandmarkVisit | null>(
    null,
  );
  const layerRef = useRef<HTMLDivElement>(null);
  const chinese = settings.language.startsWith("zh");
  useEffect(() => {
    if (!on) return;
    let currentStage: Stage = "orbit";
    let distance = 0;
    let serial = 0;
    let visitorSerial = 0;
    let visitorFootSerial = 0;
    let visitor: Encounter | null = null;
    let visitorFeet: Foot[] = [];
    let landmark: LandmarkVisit | null = null;
    const clearLandmark = () => {
      landmark = null;
      setLandmarkVisit(null);
    };
    clearLandmark();
    const landmarksOnPaper = (): LandmarkTarget[] =>
      Array.from(
        layerRef.current?.querySelectorAll<HTMLElement>(
          ".magic-map-landmark",
        ) ?? [],
      ).flatMap((node) => {
        const box = node.querySelector("svg")?.getBoundingClientRect();
        return box?.width && box.height
          ? [
              {
                id: Number(node.dataset.landmark),
                point: {
                  x: box.left + box.width / 2,
                  y: box.bottom + 12,
                  heading: 0,
                },
              },
            ]
          : [];
      });
    const quietMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const nextEncounter = () =>
      Math.ceil((18000 + Math.random() * 18000) / STEP_MS);
    let encounterCountdown = nextEncounter();
    const clearEncounter = () => {
      visitor = null;
      visitorFeet = [];
      setVisitorDrawing(null);
      encounterCountdown = nextEncounter();
    };
    clearEncounter();
    // Distance since the last printed footfall. Carry a partial final step
    // across a stop or turn; never stamp a tiny extra step at the target.
    let unprinted = 0;
    let pos = orbitPoint(window.innerWidth, window.innerHeight, distance);
    let travel: {
      to: Point;
      purpose: "diary" | "perimeter" | "landmark";
      resume: number;
      turnId?: number;
    } | null = null;
    const changeStage = (next: Stage) => {
      currentStage = next;
      setStage(next);
    };
    const stamp = () => {
      const right = serial % 2 === 1;
      const angle = (pos.heading * Math.PI) / 180;
      const offset = right ? 5 : -5;
      const foot = {
        id: ++serial,
        x: pos.x - Math.sin(angle) * offset,
        y: pos.y + Math.cos(angle) * offset,
        heading: pos.heading,
        right,
      };
      setFeet((previous) => [...previous.slice(-6), foot]);
    };
    changeStage("orbit");
    setFeet([]);
    stamp();
    const tick = () => {
      if (document.hidden) return;
      if (travel) {
        const step = stepToward(pos, travel.to, STRIDE - unprinted);
        pos = step.point;
        unprinted += step.moved;
        if (unprinted >= STRIDE - 1e-6) {
          stamp();
          unprinted = 0;
        }
        if (step.arrived) {
          distance = travel.resume;
          const turnId = travel.turnId;
          const purpose = travel.purpose;
          travel = null;
          if (purpose === "landmark" && landmark) {
            landmark = { ...landmark, phase: "active", ticks: 0 };
            setLandmarkVisit(landmark);
            changeStage("landmark");
          } else {
            const arrived = purpose === "diary";
            changeStage(arrived ? "standing" : "orbit");
            if (!arrived) {
              clearLandmark();
              if (unprinted > 0) {
                distance += STRIDE - unprinted;
                pos = orbitPoint(
                  window.innerWidth,
                  window.innerHeight,
                  distance,
                );
                stamp();
                unprinted = 0;
              }
            }
            if (arrived)
              window.dispatchEvent(
                new CustomEvent(WALKER_ARRIVED_EVENT, { detail: { turnId } }),
              );
          }
        }
      } else if (currentStage === "landmark" && landmark) {
        landmark = { ...landmark, ticks: landmark.ticks + 1 };
        if (landmark.ticks >= 6) {
          landmark = { ...landmark, phase: "departing" };
          travel = {
            to: orbitPoint(window.innerWidth, window.innerHeight, distance),
            resume: distance,
            purpose: "perimeter",
          };
          changeStage("returning");
          encounterCountdown = nextEncounter();
        }
        setLandmarkVisit(landmark);
      } else if (currentStage === "orbit") {
        distance += STRIDE - unprinted;
        unprinted = 0;
        pos = orbitPoint(window.innerWidth, window.innerHeight, distance);
        stamp();
      }
      if (quietMotion.matches) {
        if (visitor) {
          clearEncounter();
          if (currentStage === "encounter") changeStage("orbit");
        }
        return;
      }
      if (currentStage !== "orbit" && currentStage !== "encounter") return;
      const perimeter = orbitLength(window.innerWidth, window.innerHeight);
      if (!visitor) {
        if (--encounterCountdown > 0) return;
        if (Math.random() < 0.45) {
          const target = chooseLandmark(landmarksOnPaper(), pos, Math.random());
          if (target) {
            landmark = {
              id: target.id,
              event: Math.floor(Math.random() * 2),
              phase: "approaching",
              ticks: 0,
            };
            setLandmarkVisit(landmark);
            travel = {
              to: target.point,
              resume: distance,
              purpose: "landmark",
            };
            changeStage("visiting");
            encounterCountdown = nextEncounter();
            return;
          }
        }
        visitor = createEncounter(
          ++visitorSerial,
          distance,
          perimeter,
          Math.random(),
        );
      } else visitor = advanceEncounter(visitor, distance, perimeter);
      if (!visitor) {
        clearEncounter();
        if (currentStage === "encounter") changeStage("orbit");
        return;
      }
      const point = orbitPoint(
        window.innerWidth,
        window.innerHeight,
        visitor.distance,
      );
      point.heading += 180;
      if (visitor.phase === "greeting") changeStage("encounter");
      else {
        if (currentStage === "encounter") changeStage("orbit");
        const right = visitorFootSerial % 2 === 1;
        const angle = (point.heading * Math.PI) / 180;
        const side = right ? 5 : -5;
        const foot = {
          id: ++visitorFootSerial,
          x: point.x - Math.sin(angle) * side,
          y: point.y + Math.cos(angle) * side,
          heading: point.heading,
          right,
        };
        visitorFeet = [...visitorFeet.slice(-4), foot];
      }
      setVisitorDrawing({
        encounter: visitor,
        point,
        hero: { ...pos },
        feet: visitorFeet,
      });
    };
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<MagicDiaryEvent>).detail;
      if (!detail) return;
      if (detail.phase === "absorbed") {
        clearEncounter();
        clearLandmark();
        const at = detail.at;
        const to = {
          x: Math.max(14, (at?.left ?? window.innerWidth / 2) - 26),
          y: at ? at.top + at.height / 2 : window.innerHeight / 2,
          heading: 0,
        };
        travel = {
          to,
          purpose: "diary",
          resume: distance,
          turnId: detail.turnId,
        };
        changeStage("approach");
      } else if (detail.phase === "leaving") {
        clearEncounter();
        clearLandmark();
        const resume =
          Math.random() * orbitLength(window.innerWidth, window.innerHeight);
        travel = {
          to: orbitPoint(window.innerWidth, window.innerHeight, resume),
          purpose: "perimeter",
          resume,
        };
        changeStage("leaving");
      }
    };
    const timer = setInterval(tick, STEP_MS);
    window.addEventListener(MAGIC_DIARY_EVENT, onEvent);
    return () => {
      clearInterval(timer);
      window.removeEventListener(MAGIC_DIARY_EVENT, onEvent);
    };
  }, [on]);
  if (!on) return null;
  return (
    <div
      className="magic-footprint-layer"
      ref={layerRef}
      data-stage={stage}
      aria-hidden="true"
    >
      <MapLandmarks chinese={chinese} visit={landmarkVisit} />
      {feet.map((foot) => (
        <div
          key={foot.id}
          className="magic-foot"
          style={{
            left: foot.x,
            top: foot.y,
            rotate: `${foot.heading}deg`,
            scale: `1 ${foot.right ? -1 : 1}`,
          }}
        >
          <FootGlyph />
        </div>
      ))}
      {visitorDrawing && (
        <>
          {visitorDrawing.feet.map((foot) => (
            <div
              key={`visitor-${foot.id}`}
              className="magic-visitor-foot"
              style={{
                left: foot.x,
                top: foot.y,
                rotate: `${foot.heading}deg`,
                scale: `1 ${foot.right ? -1 : 1}`,
              }}
            >
              <FootGlyph />
            </div>
          ))}
          <div
            key={visitorDrawing.encounter.id}
            className={`magic-map-visitor magic-map-visitor-${visitorDrawing.encounter.kind}`}
            data-phase={visitorDrawing.encounter.phase}
            style={{
              left: visitorDrawing.point.x,
              top: visitorDrawing.point.y,
            }}
          >
            <VisitorGlyph kind={visitorDrawing.encounter.kind} />
            <span className="magic-map-visitor-name">
              {VISITOR_NAMES[visitorDrawing.encounter.kind][chinese ? 0 : 1]}
            </span>
            {visitorDrawing.encounter.phase === "greeting" && (
              <i className="magic-map-ripple" />
            )}
          </div>
          {visitorDrawing.encounter.phase === "greeting" && (
            <div
              className={`magic-map-reaction ${visitorDrawing.encounter.kind === "beast" ? "magic-map-shield" : "magic-map-salute"}`}
              style={{
                left: visitorDrawing.hero.x,
                top: visitorDrawing.hero.y,
              }}
            >
              <svg
                viewBox="0 0 70 70"
                width="70"
                height="70"
                fill="none"
                stroke="currentColor"
                strokeWidth=".8"
              >
                {visitorDrawing.encounter.kind === "beast" ? (
                  <>
                    <path d="M35 10 53 18v16c0 12-9 20-18 26-9-6-18-14-18-26V18Z" />
                    <circle cx="35" cy="33" r="25" strokeDasharray="2 6" />
                    <path d="m55 8 3 6 7 1-6 4 1 7-5-5-6 3 2-7-4-5 7 1Z" />
                  </>
                ) : (
                  <>
                    <circle cx="35" cy="35" r="21" strokeDasharray="1 5" />
                    <path d="M35 22v26M22 35h26m-22-9 18 18m-18 0 18-18" />
                  </>
                )}
              </svg>
            </div>
          )}
        </>
      )}
    </div>
  );
}
