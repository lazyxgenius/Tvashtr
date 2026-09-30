/** A connector's letter tile ("Sb", "No"): 32px in lists, 44px on its page. */
import { cx } from "../../design-system/components/utils";
import { tileLetters } from "./connectorFormat";

export function ConnectorTile({
  connectorKey,
  name,
  size = "sm",
}: {
  connectorKey: string;
  name: string;
  size?: "sm" | "lg";
}) {
  return (
    <span className={cx("cn-tile", size === "lg" && "cn-tile--lg")} aria-hidden="true">
      {tileLetters(connectorKey, name)}
    </span>
  );
}
