# Models 1 — the design (copied from the Claude Design canvas "Tvashtr Models", version 8, approved 2026-11-01)

Canvas: https://claude.ai/artifact/Tvis4EKWWQxMzGsTB294wf — the build session can't open it, so everything it needs is here.
Copied by the architect (Tvashtr Sidechat-28). These files belong to the architect: never edit, stage or commit them.

| Screen | Source (exact text, sizes, colours) | Picture (rendered from the source at 1440 wide) |
|---|---|---|
| 1a. Models — first time | `Main.dc.html` (prop `view` = "First time") | `MainFirstTime.png` |
| 1b. Models — the list | `Main.dc.html` (prop `view` = "With models") | `Main.png` |
| 2. New model dialog | `NewModel.dc.html` | `NewModel.png` |
| 3. A model — Tests tab | `Tests.dc.html` | `Tests.png` |
| 4. Edit a test (right drawer, AI judge) | `EditTest.dc.html` | `EditTest.png` |
| 5. Run tests dialog (cost first) | `RunTests.dc.html` | `RunTests.png` |
| 6. Results — score cards + compare two models | `Results.dc.html` | `Results.png` |

How to read the sources:
- Each `.dc.html` is one artboard. The markup between `<x-dc>` and `</x-dc>` is the screen; `<style>` holds every size and colour
  (the `:root` colour values are the app's own tokens from `frontend/src/design-system/tokens/colors.css`).
- `<x-import component-from-global-scope="DesignSystem_dbaa69.Button" variant="primary">` = the app's own design-system component
  (`frontend/src/design-system/components`: Button, Badge, Tabs, Input/TextArea, Select, Checkbox) with those props. Use the real
  components, never copies.
- `class="tv-seg"` / `tv-seg__btn` = the app's existing segmented control (`frontend/src/index.css`).
- `<sc-for list="{{ rows }}">` repeats for each item of the sample data in the `<script>` at the bottom of the file;
  `<sc-if value="{{ x }}">` shows its content only when `x` is true. The sample data is what the pictures show.
- The shell (60px header, 224px menu, the coral current item, the menu's foot note) is the app's existing shell
  (`frontend/src/pages/shell/`). In these sources it is drawn by hand only so the artboard stands alone — keep the real one.
- The pictures were rendered outside the canvas viewer (fonts loaded, the brand mark image is missing at top left). The sources win
  where a picture and a source differ.

The operator's one change (applied in the sources): models are NOT listed one by one under "Models" in the left menu (unlike
Domains). The menu shows only "Models"; it stays highlighted on every Models page, and a model's page has the breadcrumb back.
