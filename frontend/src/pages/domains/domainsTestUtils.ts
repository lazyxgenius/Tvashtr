/**
 * Test helpers for the Domains pages: summary items shaped like `GET /api/domains` and a fetch
 * mock that answers "METHOD /path" routes (`:id` segments match anything) and records calls.
 */
import { vi } from "vitest";

import type {
  DomainDetailView,
  DomainFile,
  DomainFilesList,
  DomainListItem,
} from "../../lib/api/domains";

export const NOW = new Date("2026-09-26T12:00:00Z");

export function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString();
}

export function domainItem(over: Partial<DomainListItem> & { name: string }): DomainListItem {
  const id = over.domain_id ?? `d-${over.name.toLowerCase().replace(/\W+/g, "-")}`;
  return {
    domain_id: id,
    template: "support",
    config: {},
    status: "ready",
    doc_count: 0,
    created_at: hoursAgo(72),
    updated_at: hoursAgo(2),
    files: {
      total: 0,
      ready: 0,
      reading: 0,
      waiting: 0,
      waiting_for_key: 0,
      needs_attention: 0,
    },
    pieces: 0,
    state: "empty",
    quality: {
      cases: 0,
      last_run_at: null,
      hit_at_k: null,
      keyword_hit: null,
      retrieval_mode: null,
      top_k: null,
    },
    usage: { uses: 0, teams: 0, steps: 0, agents: 0 },
    last_activity_at: hoursAgo(2),
    reading_model: {
      slug: "openai/text-embedding-3-small",
      label: "OpenAI text-embedding-3-small",
      provider: "openai",
      dim: 1536,
      key_saved: true,
    },
    ...over,
  };
}

/** The design's four sample domains (Dm-List). */
export function sampleDomains(): DomainListItem[] {
  const files = (total: number, part: Partial<DomainListItem["files"]>) => ({
    total,
    ready: 0,
    reading: 0,
    waiting: 0,
    waiting_for_key: 0,
    needs_attention: 0,
    ...part,
  });
  return [
    domainItem({
      name: "Support docs",
      domain_id: "d-support",
      state: "ready",
      files: files(14, { ready: 14 }),
      pieces: 1212,
      quality: {
        cases: 12,
        last_run_at: hoursAgo(26),
        hit_at_k: 0.83,
        keyword_hit: 0.75,
        retrieval_mode: "hybrid",
        top_k: 8,
      },
      usage: { uses: 3, teams: 2, steps: 1, agents: 2 },
      last_activity_at: hoursAgo(2),
    }),
    domainItem({
      name: "Vendor contracts",
      domain_id: "d-vendor",
      template: "legal",
      state: "reading",
      files: files(6, { ready: 4, reading: 1, waiting: 1 }),
      pieces: 310,
      last_activity_at: hoursAgo(0),
    }),
    domainItem({
      name: "Research papers",
      domain_id: "d-research",
      template: "scientific",
      state: "needs_attention",
      files: files(9, { ready: 8, needs_attention: 1 }),
      pieces: 640,
      quality: {
        cases: 5,
        last_run_at: hoursAgo(30),
        hit_at_k: 0.6,
        keyword_hit: null,
        retrieval_mode: "dense",
        top_k: 8,
      },
      usage: { uses: 1, teams: 1, steps: 1, agents: 0 },
      last_activity_at: hoursAgo(27),
    }),
    domainItem({
      name: "Q3 filings",
      domain_id: "d-q3",
      template: "financial",
      state: "empty",
      created_at: "2026-09-23T09:00:00Z",
      last_activity_at: hoursAgo(75),
    }),
  ];
}

type Reply = ((init: RequestInit | undefined, url: URL) => unknown) | object | null;

export interface MockCall {
  method: string;
  path: string;
  body: unknown;
}

/** Mock `fetch` from a route table. Unknown routes answer 404. Returns the recorded calls. */
export function mockApi(routes: Record<string, Reply>): MockCall[] {
  const calls: MockCall[] = [];
  const table = Object.entries(routes).map(([key, reply]) => {
    const [method, path] = key.split(" ");
    const re = new RegExp(`^${path.replace(/:[^/]+/g, "[^/]+")}$`);
    return { method, re, reply };
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;
      calls.push({ method, path: url.pathname, body });
      const hit = table.find((r) => r.method === method && r.re.test(url.pathname));
      if (!hit) {
        return Promise.resolve(
          new Response(JSON.stringify({ detail: "no route" }), { status: 404 }),
        );
      }
      const out: unknown = typeof hit.reply === "function" ? hit.reply(init, url) : hit.reply;
      if (out instanceof Response) return Promise.resolve(out);
      return Promise.resolve(new Response(JSON.stringify(out), { status: 200 }));
    }),
  );
  return calls;
}

/** `GET /api/domains/{id}`: a list item plus the detail keys (first read done, key saved). */
export function detailView(
  item: DomainListItem,
  over: Partial<DomainDetailView> = {},
): DomainDetailView {
  return {
    ...item,
    setup: {
      key: true,
      files_read: true,
      tested: item.quality.cases > 0,
      used: item.usage.uses > 0,
    },
    answer_model: {
      configured: null,
      resolved: "openai/gpt-4o-mini",
      label: "OpenAI gpt-4o-mini",
      provider: "openai",
      key_saved: true,
    },
    last_question_at: null,
    ...over,
  };
}

/** One `GET …/documents` item (ready unless `phase` says otherwise). */
export function fileItem(name: string, over: Partial<DomainFile> = {}): DomainFile {
  const ext = name.split(".").pop();
  const phase = over.phase ?? "ready";
  const pieces = over.pieces === undefined ? (phase === "ready" ? 42 : null) : over.pieces;
  return {
    document_id: `doc-${name.replace(/\W+/g, "-")}`,
    filename: name,
    byte_size: 18 * 1024,
    created_at: "2026-09-12T10:00:00Z",
    version: 1,
    kind: ext === "pdf" ? "PDF" : ext === "html" ? "HTML" : ext === "txt" ? "TXT" : "MD",
    phase,
    pieces,
    pieces_total: pieces ?? 0,
    pieces_done: pieces ?? 0,
    progress: null,
    problem: null,
    matched: null,
    ...over,
  };
}

/** A `GET …/documents` answer for `files` (counts from their phases). */
export function filesList(files: DomainFile[]): DomainFilesList {
  const counts = { all: files.length, ready: 0, reading: 0, needs_attention: 0 };
  for (const f of files) {
    if (f.phase === "ready") counts.ready += 1;
    else if (f.phase === "needs_attention") counts.needs_attention += 1;
    else counts.reading += 1;
  }
  return {
    documents: files,
    counts,
    total_pieces: files.reduce((n, f) => n + (f.pieces ?? 0), 0),
  };
}
