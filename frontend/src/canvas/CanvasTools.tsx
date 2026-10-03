import { LayoutGrid, SquareDashed } from "lucide-react";

/**
 * M11 (Cnv-Tidy, Cnv-Group): Tidy and Group, in the canvas's top-left row beside "Add to canvas"
 * (which stays as it is, with every add option). Tidy explains itself on hover. A button is lit
 * while what it did is on screen: Tidy's dashed old places, Group's new frame being named.
 */
export function CanvasTools({
  onTidy,
  tidyOn,
  onGroup,
  groupOn,
  canGroup,
  disabled = false,
}: {
  onTidy: () => void;
  tidyOn: boolean;
  onGroup: () => void;
  groupOn: boolean;
  /** Some agents are selected to put in a group. */
  canGroup: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="cv-tools" role="toolbar" aria-label="Arrange">
      <span className="cv-tools__wrap">
        <button
          type="button"
          className="cv-tools__btn"
          aria-pressed={tidyOn}
          aria-describedby="cv-tidy-tip"
          disabled={disabled}
          onClick={onTidy}
        >
          <LayoutGrid size={15} strokeWidth={1.6} aria-hidden />
          Tidy
        </button>
        <span role="tooltip" id="cv-tidy-tip" className="cv-tip cv-tip--below">
          <span className="cv-tip__title">Tidy</span>
          Lines agents up left to right in the order work flows, with gates between them. Dashed
          boxes show where they were.
        </span>
      </span>
      <button
        type="button"
        className="cv-tools__btn"
        aria-pressed={groupOn}
        disabled={disabled || !canGroup}
        onClick={onGroup}
      >
        <SquareDashed size={15} strokeWidth={1.6} aria-hidden />
        Group
      </button>
    </div>
  );
}
