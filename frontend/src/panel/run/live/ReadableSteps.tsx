import "./live.css";

import type { ActivityLine } from "../../../lib/api/activity";
import { clock } from "./liveFormat";

/**
 * M2 — one agent's steps in plain words, in its drawer (Runs › Live-AgentSteps): "Readable shows one
 * line per step. Raw log is the full record the agent wrote, with every command, file and output."
 */
export function ReadableSteps({ lines }: { lines: ActivityLine[] }) {
  return (
    <>
      {lines.length === 0 ? (
        <p className="lv-steps__empty">No steps yet.</p>
      ) : (
        <ol className="lv-steps" aria-label="Steps">
          {lines.map((l) => (
            <li key={l.id} className="lv-steps__row">
              <span className="lv-line__time">{clock(l.at)}</span>
              <span className="lv-steps__what">{l.text}</span>
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
