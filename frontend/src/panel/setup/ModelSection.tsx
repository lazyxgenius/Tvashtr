import { useState } from "react";
import { AlertTriangle, KeyRound, Monitor } from "lucide-react";

import { Switch } from "../../design-system/components";
import type { Capability, ProviderCatalogueEntry } from "../../lib/api";
import type { ChangeGroup } from "../agentDraft";
import { type ModelGroup, modelGroups, pickerNote, unknownModel } from "./modelCatalog";
import { type CredentialCover, type ModelHint, modelHint } from "./modelCopy";
import { SameModelAdvisory, UnknownModelWarning } from "./ModelNotices";
import { ModelPicker } from "./ModelPicker";
import { SettingRow, SettingSection } from "./SettingRow";
import { TIPS } from "./setupCopy";

export function HintLine({ hint }: { hint: ModelHint }) {
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

const DISMISSED_KEY = "tvashtr.panel.sameModelDismissed";

/** The same-model advisory stays dismissed for this agent and model until the tab closes. */
function advisoryDismissed(nodeId: string, model: string): boolean {
  try {
    return window.sessionStorage.getItem(`${DISMISSED_KEY}.${nodeId}`) === model;
  } catch {
    return false;
  }
}

function rememberAdvisoryDismissed(nodeId: string, model: string): void {
  try {
    window.sessionStorage.setItem(`${DISMISSED_KEY}.${nodeId}`, model);
  } catch {
    // Storage blocked: it stays dismissed while this drawer is open.
  }
}

/** What both model pickers (main and backup) need from the editor. */
export interface ModelPickerContext {
  catalogue: readonly ProviderCatalogueEntry[];
  seat: Capability;
  cover: CredentialCover | null;
  desktop: boolean;
  /** Providers whose key was added from the picker in this drawer ("(saved in Engines)"). */
  justAdded: ReadonlySet<string>;
  onKeySaved?: (group: ModelGroup) => void;
  onAddProvider?: () => void;
}

/**
 * The Model section (Desktop-ModelPicker, Panel-ModelWeb, Panel-Warnings): the model picker with
 * its credential hint, the same-model advisory for a verdict agent, the unknown-model warning, and
 * the Images switch.
 */
export function ModelSection({
  nodeId,
  model,
  onModelChange,
  multimodal,
  onMultimodalChange,
  picker,
  sameModelAs,
  agentName,
  changed,
}: {
  nodeId: string;
  model: string;
  onModelChange: (model: string) => void;
  multimodal: boolean;
  onMultimodalChange: (value: boolean) => void;
  picker: ModelPickerContext;
  /** The connected agent that runs the same model (a verdict agent only), if any. */
  sameModelAs: string | null;
  agentName: string;
  changed: readonly ChangeGroup[];
}) {
  const slug = model.trim();
  const hint = modelHint(slug, picker.cover, picker.desktop, {
    justAdded: picker.justAdded,
    catalogue: picker.catalogue,
  });
  // The advisory and the warning each come back when the model changes.
  const [advisoryHidden, setAdvisoryHidden] = useState<string | null>(null);
  const [unknownHidden, setUnknownHidden] = useState<string | null>(null);
  const unknown = unknownModel(slug, picker.catalogue);
  const note = pickerNote(
    modelGroups(picker.catalogue, picker.seat, picker.cover, {
      desktop: picker.desktop,
      current: slug,
    }),
  );
  const showAdvisory =
    sameModelAs !== null && advisoryHidden !== slug && !advisoryDismissed(nodeId, slug);
  return (
    <SettingSection title="Model">
      <SettingRow
        label="Model"
        tip={note}
        hint={hint ? <HintLine hint={hint} /> : undefined}
        changed={changed.includes("model")}
      >
        <ModelPicker
          model={model}
          onPick={onModelChange}
          emptyLabel="Choose a model"
          label="Choose a model"
          catalogue={picker.catalogue}
          seat={picker.seat}
          cover={picker.cover}
          desktop={picker.desktop}
          onKeySaved={picker.onKeySaved}
          onAddProvider={picker.onAddProvider}
        />
      </SettingRow>
      {showAdvisory && (
        <SameModelAdvisory
          name={agentName}
          sibling={sameModelAs}
          model={slug}
          onDismiss={() => {
            rememberAdvisoryDismissed(nodeId, slug);
            setAdvisoryHidden(slug);
          }}
        />
      )}
      {unknown && unknownHidden !== unknown && (
        <UnknownModelWarning model={unknown} onDismiss={() => setUnknownHidden(unknown)} />
      )}
      <SettingRow label="Images" tip={TIPS.images} changed={changed.includes("images")}>
        <Switch aria-label="Images" checked={multimodal} onCheckedChange={onMultimodalChange} />
      </SettingRow>
    </SettingSection>
  );
}
