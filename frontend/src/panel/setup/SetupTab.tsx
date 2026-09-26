import { AlertTriangle, KeyRound, Monitor } from "lucide-react";

import { Switch } from "../../design-system/components";
import type { GraphEdge, TeamGraphNode } from "../../lib/api";
import type { AgentDraftApi } from "../useAgentDraft";
import { AccessSection } from "./AccessSection";
import { AdvancedSection } from "./AdvancedSection";
import { InstructionsCard } from "./InstructionsCard";
import { ModelButton } from "./ModelButton";
import { type CredentialCover, type ModelHint, modelHint } from "./modelCopy";
import { routingOf } from "./routing";
import { RoutingStatus } from "./RoutingStatus";
import { SettingRow, SettingSection } from "./SettingRow";
import { runtimeBanner, TIPS } from "./setupCopy";

function HintLine({ hint }: { hint: ModelHint }) {
  const Icon =
    hint.icon === "monitor"
      ? Monitor
      : hint.icon === "key"
        ? KeyRound
        : hint.icon === "warn"
          ? AlertTriangle
          : null;
  if (!Icon) return <>{hint.text}</>;
  return (
    <span className="nd-hint__icon">
      <Icon size={13} strokeWidth={1.7} aria-hidden />
      {hint.text}
    </span>
  );
}

/**
 * The Setup tab (Main / Web-Setup / Panel-FullLength): instructions with the routing line, the
 * model and Images, Access & documents, and the Advanced disclosure. Every edit goes into the
 * shared draft; nothing is saved until Save.
 */
export function SetupTab({
  node,
  nodes,
  edges,
  isEntry,
  draft: api,
  cover,
  onOpenFullEditor,
}: {
  node: TeamGraphNode;
  nodes: TeamGraphNode[];
  edges: GraphEdge[];
  isEntry: boolean;
  draft: AgentDraftApi;
  /** The account's credentials (null while loading). */
  cover: CredentialCover | null;
  onOpenFullEditor?: () => void;
}) {
  const { draft, set, update } = api;
  const routing = routingOf(node.id, draft.prompt, nodes, edges);
  const hint = modelHint(draft.model, cover);
  return (
    <div className="nd-stack">
      <InstructionsCard
        prompt={draft.prompt}
        onChange={(v) => set("prompt", v)}
        banner={runtimeBanner({
          isEntry,
          readsFrom: draft.readsFrom,
          readsDefault: draft.readsDefault,
        })}
        routing={<RoutingStatus routing={routing} />}
        onOpenFullEditor={onOpenFullEditor}
      />
      <SettingSection title="Model">
        <SettingRow
          label="Model"
          tip={TIPS.model}
          hint={hint ? <HintLine hint={hint} /> : undefined}
        >
          <ModelButton model={draft.model} emptyLabel="Choose a model" />
        </SettingRow>
        <SettingRow label="Images" tip={TIPS.images}>
          <Switch
            aria-label="Images"
            checked={draft.multimodal}
            onCheckedChange={(v) => set("multimodal", v)}
          />
        </SettingRow>
      </SettingSection>
      <AccessSection
        editsAllowed={draft.editsAllowed}
        onEditsChange={(v) => set("editsAllowed", v)}
        isEntry={isEntry}
        readsFrom={draft.readsFrom}
        readsDefault={draft.readsDefault}
        onReadsChange={(readsFrom, readsDefault) => update({ readsFrom, readsDefault })}
        writesTo={draft.writesTo}
        onWritesChange={(v) => set("writesTo", v)}
      />
      <AdvancedSection fallbackModel={draft.fallbackModel} outputSchema={draft.outputSchema} />
    </div>
  );
}
