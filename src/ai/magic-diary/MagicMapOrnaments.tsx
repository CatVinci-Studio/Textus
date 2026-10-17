import type { LandmarkVisit } from "./map-landmarks";
import type { VisitorKind } from "./map-encounters";

export function VisitorGlyph({ kind }: { kind: VisitorKind }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width="25"
      height="25"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === "beast" ? (
        <>
          <path d="m6 17-2-12 9 6 6-1 9-6-2 14-5 8-6 3-7-6Z" />
          <path d="m9 17 4 2m11-2-4 2m-7 5 3 2 3-2m-3 2v3M7 10l3 4m15-5-4 5" />
          <path d="m3 25-2 2m28-3 2 3" />
        </>
      ) : kind === "wisp" ? (
        <>
          <path d="M16 3c1 9 4 12 13 13-9 1-12 4-13 13C15 20 12 17 3 16c9-1 12-4 13-13Z" />
          <circle cx="16" cy="16" r="2" />
          <path d="m25 5 2-2m-22 23-2 2" />
        </>
      ) : (
        <>
          <circle cx="16" cy="16" r="3" fill="currentColor" stroke="none" />
          <circle cx="16" cy="16" r="9" strokeDasharray="2 4" />
          <path d="M16 1v3m0 24v3M1 16h3m24 0h3" />
        </>
      )}
    </svg>
  );
}

/** Small architectural seals in the margins, drawn like a map's legend. */
export function MapLandmarks({
  chinese,
  visit,
}: {
  chinese: boolean;
  visit: LandmarkVisit | null;
}) {
  const labels = chinese
    ? ["观星阁", "无尽书廊", "回声钟", "萤火林"]
    : ["STAR LOFT", "ENDLESS STACKS", "ECHO CLOCK", "FIREFLY WOOD"];
  const events = chinese
    ? [
        ["星图显现", "风向密语"],
        ["书页自行翻开", "遗落的符文"],
        ["时间泛起涟漪", "指针逆行"],
        ["萤火聚拢", "林间传来回声"],
      ]
    : [
        ["Stars awaken", "A whisper of wind"],
        ["Pages turn alone", "Forgotten runes"],
        ["Ripples in time", "Hands turn backward"],
        ["Fireflies gather", "Echoes in the trees"],
      ];
  return (
    <div className="magic-map-landmarks">
      {labels.map((label, i) => (
        <div
          className={`magic-map-landmark magic-map-landmark-${i}`}
          key={i}
          data-landmark={i}
          data-visit={visit?.id === i ? visit.phase : undefined}
        >
          <svg
            viewBox="0 0 80 64"
            width="64"
            height="52"
            fill="none"
            stroke="currentColor"
            strokeWidth=".9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {i === 0 ? (
              <>
                <path d="M22 57h36M27 55V23h26v32M24 23 40 5l16 18ZM31 20h18M35 56V43a5 5 0 0 1 10 0v13M34 29v7m12-7v7M40 5V1l9 3-9 3" />
                <path d="M19 50V35h8m26 0h8v15M15 57h5m40 0h5" />
              </>
            ) : i === 1 ? (
              <>
                <path d="M13 54h54M19 51V23h42v28M15 23 40 10l25 13ZM24 27h32M26 30v17m9-17v17m10-17v17m10-17v17M16 51h48M10 58h60" />
                <path d="M31 5c4-2 6-1 9 1 3-2 5-3 9-1v9c-4-1-6 0-9 2-3-2-5-3-9-2ZM40 6v10" />
              </>
            ) : i === 2 ? (
              <>
                <path d="M20 56h40M26 54V22h28v32M23 22 40 6l17 16ZM31 49h18M36 54v-8h8v8" />
                <circle cx="40" cy="32" r="8" />
                <path d="M40 26v6l4 2M40 3V0M15 56h3m44 0h3" />
              </>
            ) : (
              <>
                <path d="M12 55h56M40 57V24m0-20L27 26h7L23 42h13m4-38 13 22h-7l11 16H44M20 54V35m0-15L9 39h8l-8 10h15m36 5V35m0-15 11 19h-8l8 10H56" />
                <path d="m31 58-4 4m22-4 4 4M35 51h10" />
              </>
            )}
          </svg>
          <span>{label}</span>
          <i />
          {visit?.id === i && visit.phase === "active" && (
            <div
              className={`magic-landmark-event magic-landmark-event-${i} magic-landmark-variant-${visit.event}`}
            >
              <svg
                viewBox="0 0 100 100"
                width="100"
                height="100"
                fill="none"
                stroke="currentColor"
                strokeWidth=".8"
              >
                {i === 0 ? (
                  <>
                    <circle cx="50" cy="50" r="34" strokeDasharray="1 5" />
                    <path d="m22 63 15-33 26 9 17 29-58-5 41-24-13 39-13-48" />
                    <g fill="currentColor">
                      {[
                        [22, 63],
                        [37, 30],
                        [63, 39],
                        [80, 68],
                        [50, 78],
                      ].map(([cx, cy]) => (
                        <circle key={cx} cx={cx} cy={cy} r="2" />
                      ))}
                    </g>
                  </>
                ) : i === 1 ? (
                  <>
                    <path
                      className="magic-turning-page"
                      d="M50 73V29c-12-10-23-11-34-9v41c14-3 24 0 34 12Zm0 0V29c12-10 23-11 34-9v41c-14-3-24 0-34 12Z"
                    />
                    <path d="m23 31 19 7m-19 3 19 7m16-10 19-7m-19 17 19-7" />
                    <path d="m26 12 2-5m45 5-2-5M50 19v-9" />
                  </>
                ) : i === 2 ? (
                  <>
                    <circle cx="50" cy="50" r="32" />
                    <circle cx="50" cy="50" r="40" strokeDasharray="2 7" />
                    <g className="magic-clock-hands">
                      <path d="M50 27v23l17 9" />
                      <circle cx="50" cy="50" r="2" />
                    </g>
                    <path d="M50 12v7m0 62v7M12 50h7m62 0h7" />
                  </>
                ) : (
                  <>
                    <path d="M50 86V54m-17 15 17-15 18 12" />
                    {[
                      [22, 30],
                      [48, 16],
                      [77, 29],
                      [16, 60],
                      [83, 64],
                      [50, 41],
                      [63, 80],
                    ].map(([cx, cy], n) => (
                      <g
                        key={cx}
                        className="magic-forest-spark"
                        style={{ animationDelay: `${n * 180}ms` }}
                      >
                        <circle cx={cx} cy={cy} r="2" />
                        <path d={`M${cx - 4} ${cy}h8M${cx} ${cy - 4}v8`} />
                      </g>
                    ))}
                  </>
                )}
              </svg>
              <span>{events[i][visit.event]}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
