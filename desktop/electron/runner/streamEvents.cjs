/**
 * Map each vendor CLI's streaming JSON lines onto Tvashtr's engine-neutral run events
 * (`action` {tool_name, thought, action} / `observation` {tool_name, observation} /
 * `message` {source, text} / `error` {error}) — the exact payload shapes the run canvas's node log
 * already renders for OpenHands nodes. Payload values are always plain strings, capped.
 */
const CAP = 4000;

function cap(value, n = CAP) {
  const s = typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(textOf).filter(Boolean).join("\n");
  if (content && typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (content.content !== undefined) return textOf(content.content);
  }
  return "";
}

/** Claude Code `--output-format stream-json`. */
function createClaudeStreamParser() {
  const toolNames = new Map();
  const state = { finalText: "", isError: false, errorText: null, usage: null, apiKeySource: null };

  function feed(obj) {
    const events = [];
    if (!obj || typeof obj !== "object") return events;
    if (obj.type === "system" && obj.subtype === "init") {
      state.apiKeySource = obj.apiKeySource === undefined ? null : String(obj.apiKeySource);
      const onSubscription = state.apiKeySource === "none";
      events.push({
        kind: "message",
        payload: {
          source: "claude",
          text:
            `Claude Code started — model ${obj.model || "?"} · apiKeySource: ${state.apiKeySource} · ` +
            (onSubscription
              ? "signed in with your Claude subscription (no API key)"
              : "WARNING: the CLI reports an API key source"),
        },
      });
    } else if (obj.type === "assistant" && obj.message && Array.isArray(obj.message.content)) {
      for (const item of obj.message.content) {
        if (item.type === "text" && item.text) {
          events.push({ kind: "message", payload: { source: "claude", text: cap(item.text) } });
        } else if (item.type === "tool_use") {
          toolNames.set(item.id, item.name);
          events.push({
            kind: "action",
            payload: { tool_name: String(item.name || "tool"), thought: "", action: cap(item.input) },
          });
        }
      }
    } else if (obj.type === "user" && obj.message && Array.isArray(obj.message.content)) {
      for (const item of obj.message.content) {
        if (item.type === "tool_result") {
          events.push({
            kind: "observation",
            payload: {
              tool_name: String(toolNames.get(item.tool_use_id) || "tool"),
              observation: cap(textOf(item.content)),
            },
          });
        }
      }
    } else if (obj.type === "rate_limit_event" && obj.rate_limit_info) {
      // Subscription plans report their own usage windows (e.g. "five_hour"); API keys do not.
      const info = obj.rate_limit_info;
      events.push({
        kind: "message",
        payload: {
          source: "claude",
          text: `Claude plan usage window (${info.rateLimitType || "?"}): ${info.status || "?"}`,
        },
      });
    } else if (obj.type === "result") {
      state.finalText = typeof obj.result === "string" ? obj.result : "";
      state.isError = obj.is_error === true || (obj.subtype && obj.subtype !== "success");
      if (state.isError) state.errorText = cap(state.finalText || String(obj.subtype || "error"), 2000);
      const u = obj.usage || {};
      const prompt = Number(u.input_tokens || 0) + Number(u.cache_read_input_tokens || 0) + Number(u.cache_creation_input_tokens || 0);
      const completion = Number(u.output_tokens || 0);
      state.usage = { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
      events.push({
        kind: state.isError ? "error" : "message",
        payload: state.isError
          ? { error: state.errorText }
          : { source: "claude", text: cap(`Finished: ${state.finalText}`) },
      });
    }
    return events;
  }

  return { feed, state };
}

/**
 * Grok Build `--output-format streaming-json` (observed from grok 1.0.40): `text` / `thought`
 * token chunks (`data`), `tool_call` {toolCallId, title, toolName, rawInput}, `tool_call_update`
 * {toolCallId, status: null|"completed"|"failed", content}, `usage`, and a final `end`
 * {stopReason, usage, modelUsage}. Token chunks are coalesced into one log line per run of chunks.
 * ACP-style `sessionUpdate` lines are accepted too (older/other builds).
 */
function createGrokStreamParser() {
  const titles = new Map();
  const state = {
    finalText: "",
    isError: false,
    errorText: null,
    usage: null,
    chunks: [],
    modelUsage: null,
  };
  let pendingText = "";
  let pendingThought = "";

  function flushChunks(events) {
    if (pendingThought.trim()) {
      events.push({ kind: "message", payload: { source: "grok:thinking", text: cap(pendingThought.trim(), 1500) } });
    }
    if (pendingText.trim()) {
      events.push({ kind: "message", payload: { source: "grok", text: cap(pendingText.trim()) } });
    }
    pendingText = "";
    pendingThought = "";
  }

  function updateOf(obj) {
    if (typeof obj.sessionUpdate === "string") return obj;
    if (obj.update && typeof obj.update.sessionUpdate === "string") return obj.update;
    if (obj.params && obj.params.update && typeof obj.params.update.sessionUpdate === "string") {
      return obj.params.update;
    }
    return null;
  }

  function toolCall(events, id, name, input) {
    titles.set(id, name);
    events.push({ kind: "action", payload: { tool_name: String(name || "tool"), thought: "", action: cap(input || "") } });
  }

  function toolUpdate(events, id, status, content, title) {
    if (status !== "completed" && status !== "failed") return;
    const body = Array.isArray(content)
      ? content
          .map((c) => (c && c.type === "diff" ? `diff ${c.path || ""}` : textOf(c)))
          .filter(Boolean)
          .join("\n")
      : textOf(content);
    events.push({
      kind: "observation",
      payload: { tool_name: String(titles.get(id) || title || "tool"), observation: cap(`${status}: ${body}`) },
    });
  }

  function feed(obj) {
    const events = [];
    if (!obj || typeof obj !== "object") return events;
    const u = updateOf(obj);
    const type = u ? u.sessionUpdate : obj.type;
    if (type === "text" || type === "agent_message_chunk") {
      const t = u ? textOf(u.content) : String(obj.data || "");
      state.chunks.push(t);
      pendingText += t;
      return events;
    }
    if (type === "thought" || type === "agent_thought_chunk") {
      pendingThought += u ? textOf(u.content) : String(obj.data || "");
      return events;
    }
    flushChunks(events);
    const src = u || obj;
    if (type === "tool_call") {
      toolCall(events, src.toolCallId, src.toolName || src.title || src.kind, src.rawInput || src.kind);
    } else if (type === "tool_call_update") {
      toolUpdate(events, src.toolCallId, src.status, src.content, src.title);
    } else if (type === "end") {
      const u2 = obj.usage || {};
      const prompt = Number(u2.input_tokens || 0) + Number(u2.cache_read_input_tokens || 0);
      const completion = Number(u2.output_tokens || 0);
      state.usage = { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
      state.modelUsage = obj.modelUsage && typeof obj.modelUsage === "object" ? Object.keys(obj.modelUsage) : null;
      const stop = String(obj.stopReason || "");
      if (stop && stop !== "end_turn" && stop !== "max_turns") {
        state.isError = true;
        state.errorText = `Grok Build stopped: ${stop}`;
        events.push({ kind: "error", payload: { error: state.errorText } });
      } else {
        events.push({
          kind: "message",
          payload: {
            source: "grok",
            text: `Grok Build finished (${stop || "done"})${state.modelUsage ? ` · model ${state.modelUsage.join(", ")}` : ""}`,
          },
        });
      }
    } else if (obj.error || type === "error") {
      state.isError = true;
      state.errorText = cap(textOf(obj.error) || JSON.stringify(obj), 2000);
      events.push({ kind: "error", payload: { error: state.errorText } });
    }
    return events;
  }

  function finish() {
    const tail = [];
    flushChunks(tail);
    state.tail = tail;
    if (!state.finalText) state.finalText = state.chunks.join("").trim();
    return tail;
  }

  return { feed, finish, state };
}

module.exports = { createClaudeStreamParser, createGrokStreamParser, cap };
