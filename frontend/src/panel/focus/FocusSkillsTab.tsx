import { type ComponentProps, useState } from "react";
import { BookOpen, Info, MoreHorizontal, Pencil, Sparkle, Trash } from "lucide-react";

import { Badge, Button, IconButton, Menu, type MenuEntry } from "../../design-system/components";
import type { TeamGraphNode } from "../../lib/api";
import { GithubIcon } from "../../pages/home/homeIcons";
import { skillRows, withoutSkill } from "../skills/nodeSkills";
import { SkillsToolsTab } from "../skills/SkillsToolsTab";
import { skillFacts } from "./skillFacts";

const icon = { size: 15, strokeWidth: 1.6, "aria-hidden": true } as const;

/**
 * The Skills & tools tab in focus mode (Focus-Skills, FOCUS-45..53): the drawer's lists on the left,
 * and on the right the picked skill — how it loads, its size, which agents carry it, its SKILL.md
 * and how this agent receives it. Every change still goes into the draft.
 */
export function FocusSkillsTab({
  tab,
  node,
  name,
  nodes,
  subscription,
}: {
  /** The drawer's tab, as the controller builds it (the draft, the sheets, the shelves). */
  tab: ComponentProps<typeof SkillsToolsTab>;
  node: TeamGraphNode;
  name: string;
  nodes: readonly TeamGraphNode[];
  /** "Grok" when this agent runs on a Desktop subscription. */
  subscription: string | null;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const skills = tab.skills ?? [];
  const rows = skillRows(tab.skills, tab.shelves.skillLibrary);
  const row = rows.find((r) => r.index === picked) ?? rows[0];

  let detail;
  if (!row) {
    detail = <p className="fx-skill__none">Add a skill to see what it teaches {name}.</p>;
  } else {
    const facts = skillFacts({
      row,
      skills,
      library: tab.shelves.skillLibrary,
      node,
      name,
      nodes,
      subscription,
    });
    const more: MenuEntry[] = [];
    if (row.libraryId && tab.onOpenToolkit) {
      const open = tab.onOpenToolkit;
      const skillId = row.libraryId;
      more.push(
        {
          key: "toolkit",
          label: "Open in Toolkit",
          icon: <BookOpen {...icon} />,
          onSelect: () => open({ page: "skill", skillId }),
        },
        "separator",
      );
    }
    more.push({
      key: "remove",
      label: "Remove from this agent",
      icon: <Trash {...icon} />,
      danger: true,
      onSelect: () => {
        const before = tab.skills;
        tab.onSkillsChange(withoutSkill(skills, row.index));
        tab.notify(`Removed ${row.name}`, {
          label: "Undo",
          onAction: () => tab.onSkillsChange(before),
        });
      },
    });
    detail = (
      <section className="fx-skill" aria-label={row.name}>
        <div className="fx-skill__head">
          <span className="fx-skill__icon">
            <Sparkle size={18} strokeWidth={1.6} aria-hidden />
          </span>
          <span className="fx-skill__name">{row.name}</span>
          <Badge variant={row.badge.variant}>
            {row.badge.github && <GithubIcon size={11} />}
            {row.badge.label}
          </Badge>
          <span className="fx-skill__actions">
            {/* Only a skill written on this agent is edited here (spec Q13). */}
            {row.custom && (
              <Button
                variant="secondary"
                size="sm"
                className="nd-btn-flush"
                onClick={() => tab.onEditSkill(row.index)}
              >
                <Pencil size={13} strokeWidth={1.6} aria-hidden />
                <span>Edit</span>
              </Button>
            )}
            <span className="fx-skill__more">
              <Menu
                label="More actions"
                items={more}
                trigger={(props) => (
                  <IconButton size="sm" aria-label="More actions" {...props}>
                    <MoreHorizontal {...icon} />
                  </IconButton>
                )}
              />
            </span>
          </span>
        </div>
        <dl className="fx-skill__facts">
          <Fact label="Loads" value={facts.loads} />
          <Fact label="Size" value={facts.size} />
          <Fact label="Used by" value={facts.usedBy} />
        </dl>
        <span className="fx-label">SKILL.md</span>
        {facts.content !== null ? (
          <pre className="fx-skill__md">{facts.content}</pre>
        ) : (
          <p className="fx-skill__md fx-skill__md--note">
            This skill comes from {row.badge.label}. Its SKILL.md is fetched when the team runs.
          </p>
        )}
        <p className="fx-skill__why">
          <Info size={13} strokeWidth={1.6} aria-hidden />
          <span>{facts.explanation}</span>
        </p>
      </section>
    );
  }

  return (
    <div className="fx-panes fx-panes--skills">
      <div className="fx-pane fx-pane--list">
        <SkillsToolsTab {...tab} selected={row?.index ?? null} onSelect={setPicked} />
      </div>
      <div className="fx-pane fx-pane--detail">{detail}</div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fx-fact">
      <dt className="fx-fact__label">{label}</dt>
      <dd className="fx-fact__value">{value}</dd>
    </div>
  );
}
