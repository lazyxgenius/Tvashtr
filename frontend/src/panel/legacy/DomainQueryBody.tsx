import { useEffect, useState } from "react";

import {
  type DomainQueryConfig,
  type DomainSummary,
  listDomains,
  type TeamGraphNode,
  updateDomainQueryNode,
} from "../../lib/api";
import { domainsQueryNodeHint } from "../../lib/domains";

/**
 * A Query-domain node's settings (PolyRAG Phase 4a), moved verbatim from the old TeamNodePanel into
 * the new drawer shell: the Domain select, the prompt template and its own Save. No tabs.
 */
export function DomainQueryBody({
  teamId,
  node,
  onSaved,
}: {
  teamId: string;
  node: TeamGraphNode;
  onSaved: () => void | Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [prompt, setPrompt] = useState(node.prompt ?? "");
  const dqCfg = (node.config ?? {}) as DomainQueryConfig;
  const initialDomainId = dqCfg.domain_id ?? "";
  const [domainId, setDomainId] = useState<string>(initialDomainId || "");
  const [domains, setDomains] = useState<DomainSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    listDomains()
      .then((rows) => {
        if (!cancelled) setDomains(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setDomains([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const domainDirty = domainId !== (initialDomainId || "") || prompt !== (node.prompt ?? "");
  const handleDomainQuerySave = async () => {
    if (!domainDirty) return;
    setSaving(true);
    setSaveError(false);
    try {
      await updateDomainQueryNode(teamId, node.id, {
        domain_id: domainId || null,
        prompt,
      });
      setSaved(true);
      await onSaved();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="tv-scroll tv-node-edit">
      <p className="tv-field__hint" data-testid="domains-query-hint">
        {domainsQueryNodeHint()}
      </p>
      <label className="tv-field">
        <span className="tv-field__label">Domain</span>
        <select
          className="tv-node-model"
          aria-label="Domain"
          value={domainId}
          disabled={saving}
          onChange={(e) => {
            setDomainId(e.target.value);
            setSaved(false);
          }}
        >
          <option value="">Select a Domain…</option>
          {domains.map((d) => (
            <option key={d.domain_id} value={d.domain_id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <label className="tv-field">
        <span className="tv-field__label">Prompt template</span>
        <span className="tv-field__hint">
          Use <code>{"{idea}"}</code> for the run idea.
        </span>
        <textarea
          className="tv-node-prompt"
          aria-label="Prompt template"
          value={prompt}
          rows={8}
          spellCheck={false}
          onChange={(e) => {
            setPrompt(e.target.value);
            setSaved(false);
          }}
        />
      </label>

      <div className="tv-prd__editbar">
        <button
          className="tv-btn"
          type="button"
          onClick={() => void handleDomainQuerySave()}
          disabled={!domainDirty || saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {domainDirty ? (
          <span className="tv-prd__dirty">Unsaved changes</span>
        ) : saved ? (
          <span className="tv-prd__saved">Saved — this drives the next run you launch.</span>
        ) : null}
        {saveError && <span className="tv-prd__saveerr">Couldn’t save — try again.</span>}
      </div>
    </div>
  );
}
