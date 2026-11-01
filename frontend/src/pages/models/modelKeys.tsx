/** The Add-key sheet on the Models pages (the pattern of `domains/domainKeys.tsx`): the Run dialog's
 *  **Add a key** opens it in place, so the dialog and its ticks stay. Mounted once per page. */
import { useEffect, useState } from "react";

import { type ProviderDirectoryEntry, getHomeConfig } from "../../lib/api/home";
import { isDesktopApp } from "../../lib/desktopRepos";
import { AddKeySheet } from "../home/AddKeySheet";

export function ModelKeySheet() {
  const [directory, setDirectory] = useState<ProviderDirectoryEntry[]>([]);
  useEffect(() => {
    let live = true;
    getHomeConfig()
      .then((c) => live && setDirectory(c.provider_directory))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return <AddKeySheet directory={directory} desktop={isDesktopApp()} />;
}
