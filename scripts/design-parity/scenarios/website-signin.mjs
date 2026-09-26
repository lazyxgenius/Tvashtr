// The website's sign-in screens (website.md WEB-26..30), group G2: Web-SignIn (= WbF-Start-2, the
// same screen with a coral ring on Continue with GitHub), WbF-Start-3 (#/signin/done) and WbF-Err-1
// (?error=cancelled). Hosted mode: the harness's default /api/config says hosted_mode true.
import { SIGNED_IN, SIGNED_OUT } from "./website-fixtures.mjs";

export default [
  { name: "web-signin", path: "/#/signin", routes: SIGNED_OUT },
  {
    name: "web-signin-done",
    path: "/#/signin/done",
    routes: {
      ...SIGNED_IN,
      "GET /api/teams": { teams: [] },
      "GET /api/inbox": { count: 0, items: [] },
    },
    // Hold the page on "Opening Home…": the harness drops the hand-off to #/home (the 400 ms
    // minimum would otherwise have passed before the shot).
    init: `{
      const replace = history.replaceState.bind(history);
      history.replaceState = (s, t, u) => (String(u).includes("#/home") ? undefined : replace(s, t, u));
    }`,
  },
  {
    name: "web-signin-cancelled",
    path: "/#/signin?error=cancelled",
    routes: SIGNED_OUT,
  },
];
