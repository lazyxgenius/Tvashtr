// M2 — the run view (Runs › Live-*). `kept-*` scenarios capture the kept-elements inventory of the
// existing run view (brief §2.2) — website and Desktop.
import { runPath, runRoutes } from "./runs-fixtures.mjs";

const seenDisclosure = () => sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");

export default [
  { name: "kept-runview-web", path: runPath(), routes: runRoutes("working"), settle: 900 },
  {
    name: "kept-runview-desktop",
    path: runPath(),
    routes: runRoutes("working"),
    desktop: true,
    init: seenDisclosure,
    settle: 900,
  },
  {
    name: "kept-runview-drawer-web",
    path: runPath("n-eng"),
    routes: runRoutes("working"),
    settle: 900,
  },
];
