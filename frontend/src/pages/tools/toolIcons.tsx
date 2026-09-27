/** The Tools list's icon tile: GitHub's mark for a GitHub server, a server glyph otherwise. */
import { Server } from "lucide-react";

import type { ToolItem } from "../../lib/api/tools";

/** GitHub's mark (lucide dropped its brand icons; this is the design's path). */
export function GithubMark({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}

function isGithub(tool: Pick<ToolItem, "name"> & { server_config?: ToolItem["server_config"] }) {
  const url = typeof tool.server_config?.url === "string" ? tool.server_config.url : "";
  return /github/i.test(tool.name) || /github/i.test(url);
}

/** The bare glyph: GitHub's mark for a GitHub server, a server glyph otherwise. */
export function ToolGlyph({
  tool,
  size = 15,
}: {
  tool: Pick<ToolItem, "name"> & { server_config?: ToolItem["server_config"] };
  size?: number;
}) {
  return isGithub(tool) ? (
    <GithubMark size={size} />
  ) : (
    <Server size={size} strokeWidth={1.6} aria-hidden />
  );
}

export function ToolTile({ tool }: { tool: ToolItem }) {
  return (
    <span className="tk-tile" aria-hidden="true">
      <ToolGlyph tool={tool} />
    </span>
  );
}
