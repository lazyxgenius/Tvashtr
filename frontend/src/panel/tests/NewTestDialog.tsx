import {
  Check,
  FileCode,
  FlaskConical,
  Info,
  type LucideIcon,
  MessageSquareOff,
  MessageSquareQuote,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { useRef, useState } from "react";

import { VersionDialog } from "../../canvas/VersionDialogs";
import { Button, IconButton, Input, Menu } from "../../design-system/components";
import {
  aiChecksText,
  CHECK_HINT,
  CHECK_KINDS,
  CHECK_LABEL,
  CHECK_PLACEHOLDER,
  replayCostText,
} from "../../lib/agentTestsFormat";
import {
  type AgentTest,
  type CheckKind,
  createTest,
  type FromRound,
  type TestCheck,
} from "../../lib/api/agentTests";
import { serverWords } from "../../lib/myAgentsFormat";
import { GetsList } from "./GetsList";
import "./tests.css";

type Row = TestCheck & { key: number };

/** Test-AddCheck's icons. */
const CHECK_ICON: Record<CheckKind, LucideIcon> = {
  must_say: MessageSquareQuote,
  must_not_say: MessageSquareOff,
  must_name_file: FileCode,
  ai: Sparkles,
};

/**
 * M7 Test-New: "New test from round 1" — the round's role, run and answer; the test's name; what
 * the agent got then (saved from the round); its checks, each editable in place and removable, and
 * "Add a check" (the four kinds); R7's AI-check line. Save test posts it; the server's words for a
 * refusal show inline.
 */
export function NewTestDialog({
  teamId,
  nodeId,
  round,
  onClose,
  onSaved,
}: {
  teamId: string;
  nodeId: string;
  round: FromRound;
  onClose: () => void;
  onSaved: (test: AgentTest) => void;
}) {
  const [name, setName] = useState("");
  const next = useRef(round.checks.length);
  const [checks, setChecks] = useState<Row[]>(() => round.checks.map((c, i) => ({ ...c, key: i })));
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const role = round.role;
  const canSave =
    name.trim() !== "" && checks.length > 0 && checks.every((c) => c.value.trim()) && !busy;

  const add = (kind: CheckKind) => {
    const key = next.current++;
    setChecks([...checks, { kind, value: "", key }]);
    setFocusKey(key);
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await createTest(teamId, nodeId, {
          invocation_id: round.invocation_id,
          name: name.trim(),
          checks: checks.map(({ kind, value, from_round }) => ({
            kind,
            value: value.trim(),
            ...(from_round ? { from_round } : {}),
          })),
        }),
      );
    } catch (err) {
      setError(serverWords(err, "Couldn’t save the test. Try again."));
      setBusy(false);
    }
  };

  const runPart = round.run_number != null ? ` · run #${round.run_number}` : "";
  const answered = round.answered ? ` · answered “${round.answered}”` : "";
  return (
    <VersionDialog
      title={`New test from round ${round.iteration}`}
      icon={<FlaskConical size={17} strokeWidth={1.6} aria-hidden />}
      sub={`${role}${runPart}${answered}. The test replays the ${role} on exactly what it got then.`}
      size="tt-dlg--new"
      onClose={onClose}
      footNote={replayCostText(round.estimate)}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canSave}
            loading={busy}
            iconLeft={<Check size={14} strokeWidth={2} aria-hidden />}
            onClick={() => void save()}
          >
            Save test
          </Button>
        </>
      }
    >
      <Input
        label="Test name"
        value={name}
        maxLength={120}
        required
        onChange={(e) => setName(e.target.value)}
      />
      <section className="tt-section" aria-label={`What the ${role} gets`}>
        <div className="tt-section__head">
          <span className="tt-eyebrow">What the {role} gets</span>
          <span className="tt-pill tt-pill--outline">Saved from the round</span>
        </div>
        <GetsList gets={round.gets} />
      </section>
      <section className="tt-section tt-section--checks" aria-label="Checks">
        <span className="tt-eyebrow">Checks</span>
        <ul className="tt-checks">
          {checks.map((c) => {
            const label = CHECK_LABEL[c.kind];
            return (
              <li key={c.key} className="tt-check">
                <span className="tt-check__kind">{label}</span>
                <Input
                  size="sm"
                  mono={c.kind === "must_name_file"}
                  aria-label={label}
                  placeholder={CHECK_PLACEHOLDER[c.kind]}
                  value={c.value}
                  maxLength={500}
                  autoFocus={c.key === focusKey}
                  onChange={(e) =>
                    setChecks(
                      checks.map((x) => (x.key === c.key ? { ...x, value: e.target.value } : x)),
                    )
                  }
                />
                {c.from_round ? (
                  <span className="tt-pill tt-pill--outline">from the round</span>
                ) : c.kind === "ai" ? (
                  round.ai?.available ? (
                    <span className="tt-pill tt-pill--good">Included</span>
                  ) : (
                    <span className="tt-pill">Not available yet</span>
                  )
                ) : (
                  <span />
                )}
                <IconButton
                  size="sm"
                  aria-label={`Remove ${label}`}
                  title={`Remove ${label}`}
                  onClick={() => setChecks(checks.filter((x) => x.key !== c.key))}
                >
                  <X size={14} strokeWidth={1.6} aria-hidden />
                </IconButton>
              </li>
            );
          })}
        </ul>
        {checks.length < 10 && (
          <Menu
            label="Add a check"
            align="start"
            width={290}
            items={CHECK_KINDS.map((kind) => {
              const Icon = CHECK_ICON[kind];
              return {
                key: kind,
                label: CHECK_LABEL[kind],
                description: CHECK_HINT[kind],
                icon: <Icon size={15} strokeWidth={1.6} aria-hidden />,
                onSelect: () => add(kind),
              };
            })}
            trigger={(p) => (
              <button type="button" className="tt-link tt-link--add" {...p}>
                <Plus size={13} strokeWidth={1.6} aria-hidden />
                Add a check
              </button>
            )}
          />
        )}
      </section>
      <div className="tt-info">
        <span className="tt-info__icon" aria-hidden>
          <Info size={13} strokeWidth={1.6} />
        </span>
        <span>{aiChecksText(round.ai)}</span>
      </div>
      {error && (
        <div className="lv-confirm__error" role="alert">
          {error}
        </div>
      )}
    </VersionDialog>
  );
}
