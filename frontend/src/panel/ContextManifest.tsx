import type { ContextManifest as ContextManifestData } from "../lib/api";

/**
 * M-ledger C6: the per-round context-budget snapshot for a worker round. A compact table of the
 * context `parts` (name + token count) with the round `total_tokens` vs its `budget` beneath, and —
 * when the spec was offloaded to a doc handle (`handle_used`) — a muted "Spec offloaded to SPEC.md"
 * note. Purely presentational; `LastRun` decides when a manifest is present. Classes live in
 * `panel.css` (reusing the `.tv-*` vocabulary), never `index.css`.
 */
export function ContextManifest({ manifest }: { manifest: ContextManifestData }) {
  return (
    <div className="tv-manifest" aria-label="Context manifest">
      <table className="tv-manifest__table">
        <thead>
          <tr>
            <th scope="col">Context part</th>
            <th scope="col">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {manifest.parts.map((part, idx) => (
            <tr className="tv-manifest__part" key={`${part.name}-${idx}`}>
              <td className="tv-manifest__name">{part.name}</td>
              <td className="tv-manifest__tok">{part.tokens.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="tv-manifest__total">
            <td className="tv-manifest__name">Total</td>
            <td className="tv-manifest__tok">{manifest.total_tokens.toLocaleString()}</td>
          </tr>
          <tr className="tv-manifest__budget">
            <td className="tv-manifest__name">Budget</td>
            <td className="tv-manifest__tok">{manifest.budget.toLocaleString()}</td>
          </tr>
        </tfoot>
      </table>
      {manifest.handle_used && <p className="tv-manifest__handle">Spec offloaded to SPEC.md</p>}
    </div>
  );
}
