/** A connector's letter tile ("Sb", "No"): 32px in lists, 40px in a sheet, 44px on its page. */
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
