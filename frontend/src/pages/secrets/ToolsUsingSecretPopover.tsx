/**
 * "See tools that use it" (TkF-SecretMenu-2, SECRET-14): the body of the 300px popover under a
 * secret's ⋯ — "Used by N tool(s)", then per tool its name, "a agents · t teams" (the tools list's
 * `used_by`) and an Open link to the tool's page. The popover itself is anchored by SecretRowMenu.
 */
import { useEffect, useState } from "react";

import { type SecretRef, type ToolItem, listTools } from "../../lib/api/tools";
import { routeToHash } from "../../lib/nav";
import { usedByLabel } from "../tools/toolFormat";
import { ToolGlyph } from "../tools/toolIcons";
import { toolsUsingHeading } from "./secretFormat";

/** The tools list by id, loaded when the popover opens (an empty map when it can't load). */
function useToolsById(): Map<string, ToolItem> | null {
  const [tools, setTools] = useState<Map<string, ToolItem> | null>(null);
  useEffect(() => {
    let live = true;
    listTools()
      .then((list) => live && setTools(new Map(list.map((t) => [t.id, t]))))
      .catch(() => live && setTools(new Map()));
    return () => {
      live = false;
    };
  }, []);
  return tools;
}

const toolHref = (toolId: string) => routeToHash({ page: "tool", toolId });

export function ToolsUsingSecretList({ usedBy }: { usedBy: SecretRef[] }) {
  const tools = useToolsById();
  return (
    <>
      <div className="sc-uses__head">
        <span className="sc-uses__heading">{toolsUsingHeading(usedBy.length)}</span>
      </div>
      {usedBy.map((ref) => {
        const tool = tools?.get(ref.id);
        return (
          <div key={ref.id} className="sc-uses__row">
            <ToolGlyph tool={tool ?? { name: ref.name }} size={16} />
            <div className="sc-uses__main">
              <div className="sc-uses__name">{ref.name}</div>
              {tool && <div className="sc-uses__meta">{usedByLabel(tool.used_by)}</div>}
            </div>
            <a className="sc-uses__open" href={toolHref(ref.id)}>
              Open
            </a>
          </div>
        );
      })}
    </>
  );
}
