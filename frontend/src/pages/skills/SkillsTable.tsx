import { Ellipsis, Sparkle } from "lucide-react";

import { Badge, IconButton, Menu, type MenuEntry, cx } from "../../design-system/components";
import type { Skill } from "../../lib/api/skills";
import { GithubIcon } from "../home/homeIcons";
import {
  MODE_LABEL,
  loadMode,
  sourceBadge,
  triggerPreview,
  updatedLabel,
  usedByLabel,
} from "./skillsModel";

/** The Your skills table (Toolkit-Skills): Skill / Loads by default / Used by / Updated / ⋯. Rows
 *  come sorted; a row (or its name, for the keyboard) opens the skill's editor, ⋯ opens the row's
 *  menu (TkF-SkillMenu-1), and just-added rows are tinted (TkF-FromRepo-3). */
export function SkillsTable({
  skills,
  onOpen,
  menuFor,
  highlight,
}: {
  skills: Skill[];
  onOpen: (skill: Skill) => void;
  menuFor: (skill: Skill) => MenuEntry[];
  highlight?: ReadonlySet<string>;
}) {
  return (
    <section className="sk-card sk-card--table" aria-label="Your skills">
      <table className="sk-table">
        <thead>
          <tr>
            <th scope="col">Skill</th>
            <th scope="col">Loads by default</th>
            <th scope="col">Used by</th>
            <th scope="col">Updated</th>
            <th scope="col">
              <span className="sk-sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {skills.map((s) => (
            <SkillRow
              key={s.id}
              skill={s}
              onOpen={onOpen}
              menu={menuFor(s)}
              isNew={highlight?.has(s.id) ?? false}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SkillRow({
  skill,
  onOpen,
  menu,
  isNew,
}: {
  skill: Skill;
  onOpen: (skill: Skill) => void;
  menu: MenuEntry[];
  isNew: boolean;
}) {
  const badge = sourceBadge(skill.source);
  const triggers = triggerPreview(skill.source);
  const unused = skill.usage.agents <= 0;
  return (
    <tr className={cx("sk-row", isNew && "sk-row--new")} onClick={() => onOpen(skill)}>
      <td>
        <div className="sk-skill">
          <span className="sk-tile" aria-hidden="true">
            {skill.source.type === "repo" ? (
              <GithubIcon size={15} />
            ) : (
              <Sparkle size={15} strokeWidth={1.6} />
            )}
          </span>
          <div>
            <button
              type="button"
              className="sk-name"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(skill);
              }}
            >
              {skill.name}
            </button>
            <div>
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </div>
          </div>
        </div>
      </td>
      <td>
        {MODE_LABEL[loadMode(skill.source)]}
        {triggers && (
          <>
            {" "}
            <span className="sk-trig">{triggers}</span>
          </>
        )}
      </td>
      <td>
        <span className={cx("sk-small", unused && "sk-muted")}>{usedByLabel(skill.usage)}</span>
      </td>
      <td>
        <span className="sk-small sk-muted">{updatedLabel(skill.updated_at)}</span>
      </td>
      <td>
        {/* The menu lives inside the row: its clicks must not also open the editor. */}
        <span className="sk-rowmenu" onClick={(e) => e.stopPropagation()}>
          <Menu
            label={`More actions for ${skill.name}`}
            items={menu}
            trigger={(props) => (
              <IconButton size="sm" aria-label={`More actions for ${skill.name}`} {...props}>
                <Ellipsis size={15} strokeWidth={1.6} aria-hidden />
              </IconButton>
            )}
          />
        </span>
      </td>
    </tr>
  );
}
