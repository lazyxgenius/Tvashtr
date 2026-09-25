// The dashboard shell on the Home page, website and Desktop (macOS). Used for the F0 shell parity
// gate; area scenarios copy this pattern and add the fixtures their page reads.
const routes = { "GET /api/teams": { teams: [] } };

export default [
  { name: "shell-web", path: "/#/", routes },
  { name: "shell-desktop", path: "/#/", routes, desktop: true },
];
