import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon, FolderIcon } from "../../ui/icons";
import { ProjectFiles } from "./ProjectFiles";
import type { ProjectMaterial } from "./useProjectMaterial";

/**
 * The project folder in the Agent's composer. Quiet until files are ticked
 * in its picker; then it reads "redhouse · 资料 2 · 图 2" and a send in
 * Create mode plans sections from those files and writes them one by one
 * (auto-writing) - the message being the extra requirements. No separate
 * auto-writing form: adding a folder is what brings the ability.
 */
export function ProjectChip({
  project,
  zh,
  disabled,
  onChangeFolder,
  onRemove,
}: {
  project: ProjectMaterial;
  zh: boolean;
  disabled?: boolean;
  onChangeFolder: () => void;
  /** The folder is optional: × takes it out of the composer. */
  onRemove: () => void;
}) {
  // Added from "+" just now: the picker opens with it.
  const [open, setOpen] = useState(true);
  const { suggest } = project;
  // The suggested ticks need the file list, which may arrive after opening.
  useEffect(() => {
    if (open) suggest();
  }, [open, suggest]);
  const chipRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{
    left: number;
    bottom: number;
    width: number;
  } | null>(null);
  const name = project.folder?.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const active = project.material.length + project.pictures.length > 0;

  useLayoutEffect(() => {
    if (!open || !chipRef.current) return;
    const field =
      chipRef.current.closest<HTMLElement>(".inline-chat-field") ??
      chipRef.current;
    const box = field.getBoundingClientRect();
    setPlace({
      left: box.left,
      bottom: window.innerHeight - box.top + 8,
      width: box.width,
    });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !popRef.current?.contains(target) &&
        !chipRef.current?.contains(target)
      )
        setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);

  if (!project.folder) return null;
  const counts = zh
    ? `资料 ${project.material.length} · 图 ${project.pictures.length}`
    : `${project.material.length} files · ${project.pictures.length} pictures`;
  return (
    <span ref={chipRef} className={`project-chip${active ? " is-active" : ""}`}>
      <button
        type="button"
        className="project-chip-main"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        title={
          zh
            ? "选择项目资料：创作模式下发送，会按资料规划章节并逐节写作"
            : "Pick project material: a send in Create mode plans sections from it and writes them one by one"
        }
        onClick={() => setOpen((v) => !v)}
      >
        <FolderIcon />
        <span className="project-chip-name">{name}</span>
        {active && <span className="project-chip-count">{counts}</span>}
      </button>
      <button
        type="button"
        className="project-chip-clear"
        aria-label={zh ? "移除项目文件夹" : "Remove project folder"}
        title={zh ? "移除项目文件夹" : "Remove project folder"}
        disabled={disabled}
        onClick={() => {
          setOpen(false);
          onRemove();
        }}
      >
        <CloseIcon />
      </button>
      {open &&
        place &&
        createPortal(
          <div
            ref={popRef}
            className="project-popover"
            role="dialog"
            aria-label={zh ? "项目资料" : "Project material"}
            style={{
              left: place.left,
              bottom: place.bottom,
              width: place.width,
            }}
          >
            <ProjectFiles
              root={project.folder}
              entries={project.entries}
              selected={project.chosen}
              zh={zh}
              summary={false}
              onToggle={project.toggle}
              onOpenFolder={onChangeFolder}
              onRefresh={project.refresh}
            />
            <div className="project-popover-foot">
              <span>
                {active
                  ? zh
                    ? "在「创作」模式下发送：先按这些资料列出章节，再逐节写成草稿。"
                    : "Send in Create mode: sections are planned from this material, then drafted one by one."
                  : zh
                    ? "可选：勾选大纲、要求、资料或图片，写作时参考它们。"
                    : "Optional: tick the outline, requirements, material or pictures to write from."}
              </span>
              <button
                type="button"
                className="project-popover-done"
                onClick={() => setOpen(false)}
              >
                {zh ? "完成" : "Done"}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}
