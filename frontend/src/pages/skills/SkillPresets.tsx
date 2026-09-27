import { Check, Sparkle } from "lucide-react";
import { createPortal } from "react-dom";

import { Badge, Button } from "../../design-system/components";
import type { SkillPreset } from "../../lib/api/skills";
import { useModalDialog } from "../../lib/useModalDialog";

/** The Presets tab (Toolkit-SkillPresets): one card per free preset with Add (or a disabled
 *  "In your skills" once a library skill has its name) and Preview. */
export function SkillPresetsGrid({
  presets,
  inLibrary,
  adding,
  onAdd,
  onPreview,
}: {
  presets: SkillPreset[];
  inLibrary: (preset: SkillPreset) => boolean;
  adding: string | null;
  onAdd: (preset: SkillPreset) => void;
  onPreview: (preset: SkillPreset) => void;
}) {
  return (
    <div className="sk-presets">
      {presets.map((p) => (
        <article key={p.key} className="sk-preset" aria-label={p.title}>
          <div className="sk-preset__head">
            <span className="sk-preset__icon" aria-hidden="true">
              <Sparkle size={16} strokeWidth={1.6} />
            </span>
            <h2 className="sk-preset__title">{p.title}</h2>
            <span className="sk-preset__badge">
              <Badge variant="success">{p.badge}</Badge>
            </span>
          </div>
          <p className="sk-preset__desc">{p.description}</p>
          <div className="sk-preset__actions">
            {inLibrary(p) ? (
              <Button variant="secondary" size="sm" disabled className="sk-btn-inline">
                <Check size={13} strokeWidth={1.6} aria-hidden />
                <span>In your skills</span>
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                loading={adding === p.key}
                disabled={adding !== null && adding !== p.key}
                onClick={() => onAdd(p)}
              >
                Add
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => onPreview(p)}>
              Preview
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}

/** "Preview" (TkF-Presets-1): the preset's SKILL.md as written, with Add to your skills. */
export function PresetPreviewDialog({
  preset,
  added,
  adding,
  onAdd,
  onClose,
}: {
  preset: SkillPreset | null;
  added: boolean;
  adding: boolean;
  onAdd: (preset: SkillPreset) => void;
  onClose: () => void;
}) {
  const ref = useModalDialog<HTMLDivElement>(preset !== null, onClose);
  if (!preset) return null;
  return createPortal(
    <>
      <div className="ds-scrim" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`${preset.title} preset`}
        className="ds-dialog"
        style={{ width: 640 }}
        tabIndex={-1}
      >
        <div className="sk-preview__head">
          <h2 className="sk-preview__title">{preset.title}</h2>
          <Badge variant="success">Free preset</Badge>
        </div>
        <pre className="sk-preview__md">{preset.source.content}</pre>
        <div className="ds-dialog__actions">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          {!added && (
            <Button variant="primary" size="sm" loading={adding} onClick={() => onAdd(preset)}>
              Add to your skills
            </Button>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
