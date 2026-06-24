// The PM panel's live-steering editor (P1.7b) — the ONE TipTap config shared by the
// React editor (`PrdView`) and the round-trip-stability test, so the test genuinely guards
// the editor users type into. A PRD is plain prose + a heading + a bullet list + a fenced
// code block (the deliverable's file + exact contents); the markdown must round-trip
// FAITHFULLY (a no-op load-then-save must not mutate the spec), since every Save POSTs the
// serialized markdown as a new DocumentVersion the running agents re-source (J3).

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

// tiptap-markdown 0.9.0 ships no types; declare the storage contract it adds so
// `editor.storage.markdown.getMarkdown()` type-checks (no cast, no `any`).
declare module "@tiptap/core" {
  interface Storage {
    markdown: { getMarkdown: () => string };
  }
}

// StarterKit gives us Document/Paragraph/Text/Heading/BulletList/OrderedList/ListItem/
// CodeBlock/Code/Bold/Italic/Strike — everything a mini-PRD uses. `link` is disabled: a PRD
// is a spec, not hypertext, and linkify would silently rewrite a bare path/URL on load (a
// round-trip hazard). `bulletListMarker: "-"` pins the dash the PM emits; `html: false` keeps
// the surface markdown-only (no raw HTML smuggled through a Save).
export const PRD_EDITOR_EXTENSIONS = [
  StarterKit.configure({ link: false }),
  Markdown.configure({
    html: false,
    bulletListMarker: "-",
    linkify: false,
    breaks: false,
    transformPastedText: true,
    transformCopiedText: true,
  }),
];

/**
 * Serialize the editor's current doc to markdown — the one place that reaches into
 * tiptap-markdown's (untyped) storage, so the live editor and the round-trip test read the
 * exact same bytes a Save persists.
 */
export function getMarkdown(editor: Editor): string {
  return editor.storage.markdown.getMarkdown();
}

/**
 * Parse `markdown` into the editor's doc, then serialize it straight back — exactly the
 * load→save path a no-op Save takes. Pure (builds + destroys a headless editor); used by the
 * round-trip-stability test. Faithful by construction: it shares `PRD_EDITOR_EXTENSIONS` with
 * the live editor, so what the test proves stable is what a human's Save actually persists.
 */
export function roundTripMarkdown(markdown: string): string {
  const editor = new Editor({
    extensions: PRD_EDITOR_EXTENSIONS,
    content: markdown,
  });
  try {
    return getMarkdown(editor);
  } finally {
    editor.destroy();
  }
}
