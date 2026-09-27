import { useState } from "react";

import { type GateConfig, type TeamGraphNode, updateGateNode } from "../../lib/api";
import { GUARDRAIL_GATE_KINDS } from "./legacyCopy";

/**
 * A gate's settings (M-rails C8/C9), moved verbatim from the old TeamNodePanel into the new drawer
 * shell: the gate type (human approval or an automatic guardrail), its parameters, title and
 * description, and its own dirty-aware Save. Gates have no tabs (spec PANEL-10).
 */
export function GateBody({
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

  const gateCfg = (node.config ?? {}) as GateConfig;
  const initialGateKind = gateCfg.gate_kind || "gate_approval";
  const initialGateTitle = gateCfg.title ?? "";
  const initialGateDesc = gateCfg.description ?? "";
  // The human sub-kind to restore when "Human approval" is (re)selected: preserve the node's own
  // human sub-kind (prd_approval/…); a node that started as a guardrail can't recover one → the
  // generic gate_approval.
  const humanGateKind = GUARDRAIL_GATE_KINDS.has(initialGateKind)
    ? "gate_approval"
    : initialGateKind;
  const initialForbiddenText = (gateCfg.forbidden_paths ?? []).join("\n");
  const initialOutputFile = gateCfg.output_file ?? "";
  const initialSchemaText = gateCfg.schema ? JSON.stringify(gateCfg.schema, null, 2) : "";
  const [gateKind, setGateKind] = useState(initialGateKind);
  const [gateTitle, setGateTitle] = useState(initialGateTitle);
  const [gateDesc, setGateDesc] = useState(initialGateDesc);
  const [forbiddenText, setForbiddenText] = useState(initialForbiddenText);
  const [outputFile, setOutputFile] = useState(initialOutputFile);
  const [schemaText, setSchemaText] = useState(initialSchemaText);

  // M-rails C8/C9: the gate config Save. `gateKind` is the source of truth (Human approval restores
  // the human sub-kind; each guardrail button sets its own kind). The parameterized config is sent
  // ONLY for the kind that uses it, so a human / secret_leak_scan save keeps the byte-identical
  // `{gate_kind, title, description}` body.
  const gateDirty =
    gateKind !== initialGateKind ||
    gateTitle !== initialGateTitle ||
    gateDesc !== initialGateDesc ||
    forbiddenText !== initialForbiddenText ||
    outputFile !== initialOutputFile ||
    schemaText !== initialSchemaText;
  const handleGateSave = async () => {
    if (!gateDirty) return;
    let extra:
      | {
          forbidden_paths?: string[];
          output_file?: string;
          output_schema?: Record<string, unknown>;
        }
      | undefined;
    if (gateKind === "diff_touches_forbidden_paths") {
      extra = {
        forbidden_paths: forbiddenText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      };
    } else if (gateKind === "output_schema_check") {
      let parsed: Record<string, unknown>;
      try {
        parsed = (schemaText.trim() ? JSON.parse(schemaText) : {}) as Record<string, unknown>;
      } catch {
        setSaveError(true); // invalid JSON schema — surface the error, do not save
        return;
      }
      extra = { output_file: outputFile.trim(), output_schema: parsed };
    }
    setSaving(true);
    setSaveError(false);
    try {
      await updateGateNode(teamId, node.id, gateKind, gateTitle, gateDesc, extra);
      setSaved(true);
      await onSaved();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const isGuardrail = GUARDRAIL_GATE_KINDS.has(gateKind);
  const gateTypeOptions: { kind: string; label: string; pressed: boolean }[] = [
    { kind: humanGateKind, label: "Human approval", pressed: !isGuardrail },
    {
      kind: "secret_leak_scan",
      label: "Secret leak scan",
      pressed: gateKind === "secret_leak_scan",
    },
    {
      kind: "diff_touches_forbidden_paths",
      label: "Forbidden paths",
      pressed: gateKind === "diff_touches_forbidden_paths",
    },
    {
      kind: "output_schema_check",
      label: "Output schema",
      pressed: gateKind === "output_schema_check",
    },
  ];
  const gateTypeHint =
    gateKind === "secret_leak_scan"
      ? "Secret leak scan — scans the run’s workspace and emits approved / rejected with no human pause."
      : gateKind === "diff_touches_forbidden_paths"
        ? "Forbidden paths — rejects automatically if the run’s changes touch any path you list below."
        : gateKind === "output_schema_check"
          ? "Output schema — rejects unless the named output file exists and matches the JSON schema."
          : "Human approval — the run pauses here for a person to approve or reject.";
  return (
    <div className="tv-scroll tv-node-edit">
      <div className="tv-field">
        <span className="tv-field__label">Gate type</span>
        <div className="tv-seg" role="group" aria-label="Gate type" style={{ flexWrap: "wrap" }}>
          {gateTypeOptions.map((opt) => (
            <button
              key={opt.label}
              type="button"
              aria-pressed={opt.pressed}
              disabled={saving}
              className={`tv-seg__btn${opt.pressed ? " tv-seg__btn--active" : ""}`}
              onClick={() => {
                setGateKind(opt.kind);
                setSaved(false);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="tv-field__hint">{gateTypeHint}</span>
      </div>

      {gateKind === "diff_touches_forbidden_paths" && (
        <label className="tv-field">
          <span className="tv-field__label">Forbidden paths</span>
          <span className="tv-field__hint">
            One glob per line (e.g. <code>.github/**</code>, <code>infra/**</code>,{" "}
            <code>*.pem</code>). The gate rejects if the run’s diff touches any of them.
          </span>
          <textarea
            className="tv-node-prompt"
            aria-label="Forbidden paths"
            value={forbiddenText}
            rows={4}
            spellCheck={false}
            onChange={(e) => {
              setForbiddenText(e.target.value);
              setSaved(false);
            }}
          />
        </label>
      )}

      {gateKind === "output_schema_check" && (
        <>
          <label className="tv-field">
            <span className="tv-field__label">Output file</span>
            <span className="tv-field__hint">
              A workspace-relative path to a JSON file (e.g. <code>result.json</code>).
            </span>
            <input
              className="tv-node-model"
              aria-label="Output file"
              value={outputFile}
              spellCheck={false}
              onChange={(e) => {
                setOutputFile(e.target.value);
                setSaved(false);
              }}
            />
          </label>
          <label className="tv-field">
            <span className="tv-field__label">JSON schema</span>
            <span className="tv-field__hint">
              A JSON Schema (type / required / properties / items / enum). The gate rejects unless
              the output file validates.
            </span>
            <textarea
              className="tv-node-prompt"
              aria-label="JSON schema"
              value={schemaText}
              rows={8}
              spellCheck={false}
              onChange={(e) => {
                setSchemaText(e.target.value);
                setSaved(false);
              }}
            />
          </label>
        </>
      )}

      <label className="tv-field">
        <span className="tv-field__label">Title</span>
        <input
          className="tv-node-model"
          aria-label="Gate title"
          value={gateTitle}
          spellCheck={false}
          onChange={(e) => {
            setGateTitle(e.target.value);
            setSaved(false);
          }}
        />
      </label>

      <label className="tv-field">
        <span className="tv-field__label">Description</span>
        <textarea
          className="tv-node-prompt"
          aria-label="Gate description"
          value={gateDesc}
          rows={5}
          spellCheck={false}
          onChange={(e) => {
            setGateDesc(e.target.value);
            setSaved(false);
          }}
        />
      </label>

      <div className="tv-prd__editbar">
        <button
          className="tv-btn"
          type="button"
          onClick={() => void handleGateSave()}
          disabled={!gateDirty || saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {gateDirty ? (
          <span className="tv-prd__dirty">Unsaved changes</span>
        ) : saved ? (
          <span className="tv-prd__saved">Saved — this drives the next run you launch.</span>
        ) : null}
        {saveError && <span className="tv-prd__saveerr">Couldn’t save — try again.</span>}
      </div>
    </div>
  );
}
