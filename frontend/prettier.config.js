// Prettier config for the Tvashtr frontend. Prettier-3 defaults — double quotes, semicolons,
// 2-space indent, `trailingComma: "all"` — with a wider 100-col print width to match the
// backend's ruff `line-length = 100`. Scope is `frontend/**` (see .prettierignore); ESLint
// owns correctness, Prettier owns formatting (eslint-config-prettier keeps them from fighting).
/** @type {import("prettier").Config} */
export default {
  printWidth: 100,
};
