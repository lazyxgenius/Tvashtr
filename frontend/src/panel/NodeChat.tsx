import { type FormEvent, useState } from "react";

import { askNode, type AskMessage } from "../lib/api";
import { renderChatMarkdown } from "./docs/docMarkdown";
import "./docs/viewer.css";

// Client-side turn cap matching the server's: the client holds + re-sends the whole history each
// turn, so once the transcript reaches this many messages the next request would be rejected —
// stop sending rather than round-trip a guaranteed 4xx.
const MAX_MESSAGES = 24;

/**
 * Mode A — "Ask the node": a small chat about what ONE node did during a run. The message history is
 * held CLIENT-SIDE and re-sent each turn (`askNode`), so the endpoint stays stateless; the server
 * assembles the node's recorded trail and answers only from it. Rendered inside the run-view drawer
 * (SidePanel) for both a worker and a thinker node, once the node has a recorded run.
 */
export function NodeChat({ runId, nodeId }: { runId: string | null; nodeId: string }) {
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const atCap = messages.length >= MAX_MESSAGES;
  const canSend = Boolean(runId) && draft.trim().length > 0 && !pending && !atCap;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!runId || draft.trim().length === 0 || pending || atCap) return;
    const history: AskMessage[] = [...messages, { role: "user", content: draft.trim() }];
    setMessages(history);
    setDraft("");
    setError(null);
    setPending(true);
    try {
      const { answer } = await askNode(runId, nodeId, history);
      setMessages((prev) => [...prev, { role: "assistant", content: answer }]);
    } catch (err) {
      // A Desktop Ask that couldn't be answered says why (e.g. Tvashtr Desktop went offline).
      setError(
        (err as { askError?: string } | null)?.askError ?? "Couldn't get an answer — try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="tv-chat">
      <div className="tv-scroll tv-chat__log">
        {messages.length === 0 && !pending ? (
          <p className="tv-panel-note">
            Ask what this node did, why it decided something, or what it changed — answered only
            from its recorded run.
          </p>
        ) : (
          messages.map((message, i) =>
            message.role === "assistant" ? (
              // M-desk-8 P5: the answer's markdown (markdown-it, html:false: raw HTML shows as text,
              // unsafe links stay text; no images, so an answer never makes the app fetch a URL).
              <div
                key={i}
                className="tv-chat__msg tv-chat__msg--assistant dv-md"
                dangerouslySetInnerHTML={{ __html: renderChatMarkdown(message.content) }}
              />
            ) : (
              <div key={i} className="tv-chat__msg tv-chat__msg--user">
                {message.content}
              </div>
            ),
          )
        )}
        {pending ? <p className="tv-panel-note">Thinking…</p> : null}
        {error ? <p className="tv-panel-note tv-chat__error">{error}</p> : null}
      </div>
      <form className="tv-chat__form" onSubmit={(event) => void onSubmit(event)}>
        <input
          className="tv-chat__input"
          type="text"
          aria-label="Ask this node"
          placeholder={runId ? "Ask about this node…" : "Open a run to ask"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={!runId || pending || atCap}
        />
        <button type="submit" className="tv-btn tv-chat__send" disabled={!canSend}>
          Send
        </button>
      </form>
      {atCap ? (
        <p className="tv-panel-note tv-chat__cap">Chat limit reached for this session.</p>
      ) : null}
    </div>
  );
}
