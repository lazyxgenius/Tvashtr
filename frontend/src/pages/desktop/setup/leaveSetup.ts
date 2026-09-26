import { takeAfterSetup } from "../../../lib/desktopSetup";
import { HOME, navigate } from "../../../lib/nav";

/** Setup finished: go where setup took the user from (a parked deep link, OQ-34), else Home. */
export function leaveSetup(): void {
  const after = takeAfterSetup();
  if (after) window.location.hash = after;
  else navigate(HOME);
}
