/** A connector's letter tile ("Sb", "No"): 32px in lists, 40px in the connect sheet's header,
 * 44px on its page (each plus a 1px border). */
import { cx } from "../../design-system/components/utils";
import { tileLetters } from "./connectorFormat";

export function ConnectorTile({
  connectorKey,
  name,
  size = "sm",
}: {
  connectorKey: string;
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span className={cx("cn-tile", size !== "sm" && `cn-tile--${size}`)} aria-hidden="true">
      {tileLetters(connectorKey, name)}
    </span>
  );
}
