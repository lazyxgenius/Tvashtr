import "./live.css";

import type { ActivityLine } from "../../../lib/api/activity";
import { LineIcon, LineWhat } from "./ActivityPanel";
import { clock, currentLineIds } from "./liveFormat";

/**
 * M2 — one agent's steps in plain words, in its drawer (Runs › Live-AgentSteps): "Readable shows one
 * line per step. Raw log is the full record the agent wrote, with every command, file and output."
 */
export function ReadableSteps({ lines }: { lines: ActivityLine[] }) {
  const current = currentLineIds(lines);
  return (
    <>
      {lines.length === 0 ? (
        <p className="lv-steps__empty">No steps yet.</p>
      ) : (
        <ol className="lv-steps" aria-label="Steps">
          {lines.map((l) => (
            <li key={l.id} className="lv-steps__row">
              <span className="lv-steps__time">{clock(l.at)}</span>
              <LineIcon line={l} />
              <span className={`lv-steps__what${current.has(l.id) ? " lv-now-line" : ""}`}>
                <LineWhat line={l} />
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="lv-steps__note">
        Readable shows one line per step. Raw log is the full record the agent wrote, with every
        command, file and output.
      </p>
    </>
  );
}
