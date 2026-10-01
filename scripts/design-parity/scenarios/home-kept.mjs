// M2 — the kept-elements inventory of Home (brief §2.2): the full Home with Needs you, Running now,
// Recent runs and teams, website and Desktop.
import { desktopRepos, homeRoutes, morning } from "./home-fixtures.mjs";

export default [
  { name: "kept-home-web", path: "/#/home", routes: homeRoutes(), init: morning, settle: 900 },
  {
    name: "kept-home-desktop",
    path: "/#/home",
    routes: homeRoutes(),
    desktop: true,
    init: desktopRepos,
    settle: 900,
  },
];
