// ESLint flat config for the Tvashtr frontend.
//
// Separation of concerns: ESLint owns CORRECTNESS; Prettier owns FORMATTING. `eslint-config-
// prettier` is applied LAST so every stylistic ESLint rule is turned off and the two never
// fight (we do NOT run Prettier as a lint rule — separate runners, see package.json).
//
// The whole point of the TYPE-CHECKED tier (typescript-eslint, `projectService` form so it
// picks up tsconfig.json automatically) is `no-floating-promises` / `no-misused-promises`:
// they catch real async bugs in the polling code (App.tsx / EventFeed / ABCompare) and the
// Playwright awaits in e2e/. We do NOT downgrade to the plain non-type-checked tier.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Build output + vendored + generated reports — never linted.
    ignores: ["dist", "node_modules", "coverage", "test-results", "playwright-report"],
  },

  // Plain-JS recommended applies everywhere (incl. this config + prettier.config.js).
  js.configs.recommended,

  {
    // src/** and e2e/** at the TYPE-CHECKED tier. `projectService` resolves the file's TS
    // project from tsconfig.json (which now includes `e2e`) with zero per-file wiring.
    files: ["src/**/*.{ts,tsx}", "e2e/**/*.ts"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // rules-of-hooks + exhaustive-deps as ERRORS — exhaustive-deps is the rule that would
      // have caught the missing-dep class behind the StrictMode poll freeze.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      // A co-export of a non-component from a component module breaks Fast Refresh. Kept a
      // WARN, but the gate runs `--max-warnings 0`, so a warning still fails CI — it can't
      // linger silently (resolve by splitting the constant out, or a scoped, reasoned disable).
      "react-refresh/only-export-components": "warn",
    },
  },

  {
    // Root config files don't belong to a TS project — drop them to the NON-type-checked tier
    // (so they need no tsconfig membership). They're still TS-syntax, so keep the TS parser;
    // disable-type-checked turns the project resolution + type-aware rules off.
    files: ["*.config.{ts,js}", "eslint.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      // Core `no-undef` is wrong for TS (the type system already flags unknown identifiers,
      // and it doesn't know node globals like `process`). typescript-eslint disables it for the
      // type-checked tier; mirror that here for the config files (they run under node).
      "no-undef": "off",
    },
  },

  // LAST: turn off every formatting rule (Prettier owns formatting).
  prettier,

  {
    // Any `eslint-disable` that suppresses nothing is then itself an error — so disables stay
    // honest (each one suppresses a real, current finding or it gets removed).
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
);
