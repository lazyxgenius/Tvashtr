/** "Read only" (an eye) or "Read & write" (a pencil, in the accent colour). */
import { Eye, Pencil } from "lucide-react";

import { Badge } from "../../design-system/components";
import type { ConnectorAccess } from "../../lib/api/connectors";
import { accessLabel } from "./connectorFormat";

export function AccessBadge({ access }: { access: ConnectorAccess }) {
  const Glyph = access === "write" ? Pencil : Eye;
  return (
    <Badge variant={access === "write" ? "accent" : "neutral"}>
      <Glyph size={11} strokeWidth={1.6} aria-hidden />
      {accessLabel(access)}
    </Badge>
  );
}
