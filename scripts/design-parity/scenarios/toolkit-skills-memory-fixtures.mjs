// Shared fixtures for the Toolkit › Skills + Memory parity scenarios (slice F4). Not a scenario file
// itself: toolkit-skills-memory-skills.mjs (and later -memory.mjs) import it. The data mirrors the
// design's sample data (Toolkit-Skills, Toolkit-SkillPresets, TkF-Presets-*).
export const now = Date.now();
export const ago = (min) => new Date(now - min * 60_000).toISOString();

// The page's clock stays at the moment these fixtures were built, so "Just now" stays "Just now"
// however long a sweep takes. Desktop's once-per-session subscription notice is already seen (the
// design's frames don't draw it, and it would cover the toasts). Init scripts are serialized: a
// string with the time inlined.
export const frozenClock = `(() => {
  const offset = ${now} - Date.now();
  const realNow = Date.now.bind(Date);
  Date.now = () => realNow() + offset;
  try {
    sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");
  } catch {
    /* ignore */
  }
})();`;

// The design's dates ("Sep 23", "Sep 21", "Sep 24"), at midday UTC so every time zone agrees.
const day = (d) => `2026-09-${String(d).padStart(2, "0")}T12:00:00+00:00`;

export const skill = (
  id,
  name,
  source,
  { agents = 0, teams = 0, updated = day(20) } = {},
) => ({
  id,
  name,
  source,
  created_at: day(10),
  updated_at: updated,
  usage: { agents, teams },
});

export const inline = (name, content, mode = "always", triggers) => ({
  type: "inline",
  name,
  content,
  mode,
  ...(triggers ? { triggers } : {}),
});

export const SKILLS = {
  houseStyle: skill(
    "s-house",
    "house-style",
    inline(
      "house-style",
      "# House style\n\nWrite code the way this team does.",
    ),
    { agents: 2, teams: 1, updated: day(23) },
  ),
  pytestReview: skill(
    "s-pytest",
    "pytest-review",
    {
      type: "repo",
      url: "https://github.com/org/skills",
      ref: "main",
      filter: "pytest-review",
      mode: "agent",
    },
    { agents: 1, teams: 1, updated: day(21) },
  ),
  security: skill(
    "s-sec",
    "security-checklist",
    inline(
      "security-checklist",
      "# Security checklist\n\nWhen you review code that touches auth:\n- Tokens and secrets are never logged.",
      "trigger",
      ["auth", "secrets"],
    ),
    { updated: day(24) },
  ),
};

// Toolkit-Skills: the three rows the design draws (oldest first, as the API sends them).
export const LIBRARY = [
  SKILLS.security,
  SKILLS.houseStyle,
  SKILLS.pytestReview,
];

export const YAGNI_MD =
  "# YAGNI\n\nMake the smallest change that solves the asked problem.\n- Don’t add options nobody asked for.\n- Don’t build for a future that isn’t in the spec.\n- If you’re unsure, leave it out and say so.";

const preset = (key, title, description, content) => ({
  key,
  name: key,
  title,
  description,
  access: "free",
  badge: "Free",
  attachable: true,
  source: { type: "inline", name: key, content, mode: "always" },
});

export const PRESETS = [
  preset(
    "caveman",
    "Caveman (terse)",
    "Ultra-compressed output style that keeps technical substance.",
    "# Caveman\n\nTerse output. Keep the technical substance.",
  ),
  preset(
    "tdd",
    "TDD discipline",
    "Red → green → refactor. Smallest code that makes the failing test pass.",
    "# TDD\n\nWrite the failing test first.",
  ),
  preset(
    "yagni",
    "YAGNI",
    "Smallest change that solves the asked problem, no speculative extras.",
    YAGNI_MD,
  ),
];

// Toolkit-SkillPresets: Caveman and TDD are already in the library ("In your skills"), and the
// tab still counts three skills.
export const PRESET_LIBRARY = [
  skill("s-cave", "caveman", PRESETS[0].source, { updated: day(22) }),
  skill("s-tdd", "tdd", PRESETS[1].source, { updated: day(22) }),
  SKILLS.houseStyle,
];

export const skillsRoutes = ({
  library = LIBRARY,
  presets = PRESETS,
  onCreate,
} = {}) => ({
  "GET /api/teams": { teams: [] },
  "GET /api/skill-library": () => ({ json: { skills: library } }),
  "GET /api/skill-presets": { skills: presets },
  "POST /api/skill-library": (req) => {
    const body = JSON.parse(req.postData() ?? "{}");
    const created = skill(`s-${body.name}`, body.name, body.source, {
      updated: ago(0),
    });
    onCreate?.(created);
    return { json: created };
  },
});
