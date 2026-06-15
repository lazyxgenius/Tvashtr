/** The calm landing state shown on the canvas surface before a run is started. */
export function CanvasEmpty() {
  return (
    <div className="rf-empty">
      <img src="/mark-coral.png" alt="" className="rf-empty__mark" />
      <div className="rf-empty__title">Nothing on the loom yet</div>
      <p className="rf-empty__sub">
        Start the run and the team appears — a product manager drafts the spec, an engineer
        ships it.
      </p>
    </div>
  );
}
