# PolyRAG Domains in Tvashtr — Design

Date: 2026-09-15  
Status: draft for review  
Source inspiration: PolyRAG research PDF (config-driven multi-domain RAG platform)

## Goal

Bring the PolyRAG vision into Tvashtr as **Domains**: first-class, config-driven knowledge corpora with ingest, cited Q&A, and agent access — eventually covering hybrid retrieval, eval, GraphRAG, and multimodal — while shipping in capability-sized phases.

## Product shape (locked)

| Decision | Choice |
|----------|--------|
| Product shape | **Hybrid** — Domains are first-class UI + agent-consumable |
| Architecture | **Approach A** — native in Tvashtr control plane (not a sidecar RAG server; not Desktop-only index first) |
| Hosting | **Hosted-first on Fly**; local/desktop index mode later |
| Surfaces | **Web and Desktop** (shared React UI; Desktop = Electron shell) |
| Nav | **Home \| Domains \| Engines \| Tools** |
| Vectors | **Postgres + pgvector** on existing Fly Postgres |
| LLM / embeddings | **LiteLLM + owner BYOK** (same credential story as teams) |
| Agent access | **4a** Domain query node → **4b** MCP/tool over same API |
| Scope | Full PolyRAG vision over time; **phased** delivery |

## Non-goals (early phases)

- Relaying consumer subscription sessions to Fly for RAG
- Separate Qdrant/Weaviate service in v1
- Local Desktop-primary index before hosted works
- Bringing back product A/B compare UI (removed from Tvashtr)
- Implementing GraphRAG / ColPali / full agentic loops before phases 1–4

## Phased delivery

| Phase | Delivers |
|-------|----------|
| **1** | Domain CRUD, Domains nav (web+Desktop), templates, config JSON |
| **2** | Upload documents, DBOS ingest job (chunk → embed → pgvector), doc status |
| **3** | Cited chat (`ask` + message history) |
| **4a** | Canvas **Query domain** node |
| **4b** | MCP / `domain_ask` tool wrapping same retrieve/ask API |
| **5** | Hybrid lexical + dense retrieval, rerank knobs in config/UI |
| **6** | Eval golden sets + basic quality scores |
| **7** | GraphRAG / multimodal / agentic correction loops (stretch) |

**Success for phases 1–3:** On web or Desktop, create a Support-docs domain, upload PDFs, ask a question, get a cited answer on Fly using BYOK.

## Data model

- **Domain** — `user_id`, `name`, `template` (`financial` \| `legal` \| `scientific` \| `support` \| `blank`), `config` (JSON; PolyRAG domain.yaml-as-data), `status`, timestamps
- **Document** — `domain_id`, filename, content type, storage key/path, `ingest_status`, version, timestamps
- **Chunk** — `domain_id`, `document_id`, `ordinal`, `text`, `embedding` (pgvector), optional metadata JSON
- **DomainMessage** — `domain_id`, role, content, citations JSON, optional latency/cost fields

Permissions: owner account (same pattern as teams). Domain is the tenant/config/eval boundary per PolyRAG synthesis (Vectara corpus / R2R collection / Ragie partition ideas → one Domain object).

### Config (v1 subset)

Minimal keys (expand in later phases):

```json
{
  "chunking": { "strategy": "fixed", "size": 800, "overlap": 100 },
  "embedding": { "model": "text-embedding-3-small" },
  "retrieval": { "top_k": 8, "mode": "dense" },
  "generation": { "model": null }
}
```

`mode: hybrid` / rerank / graph appear in phases 5–7. Templates seed sensible defaults (e.g. legal → smaller chunks).

## APIs

All authenticated like `/api/teams`:

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/domains` | List / create |
| GET/PATCH/DELETE | `/api/domains/{id}` | Read / update / delete |
| POST | `/api/domains/{id}/documents` | Multipart upload |
| GET | `/api/domains/{id}/documents` | List + ingest status |
| DELETE | `/api/domains/{id}/documents/{doc_id}` | Remove doc (+ chunks) |
| POST | `/api/domains/{id}/ingest` | Enqueue DBOS ingest |
| POST | `/api/domains/{id}/ask` | Retrieve + generate; citations |
| GET | `/api/domains/{id}/messages` | Chat history |

Missing embedding/chat provider keys → clear 422 / UI Configure providers (Engines), same spirit as team run preflight.

Ingest and ask use owner BYOK via existing credential resolution; no secrets in Domain rows.

## UI (web + Desktop)

Shared React:

- Left nav includes **Domains**
- **List:** name, template, doc count, ingest status, New domain
- **Detail:** Overview \| Documents \| Chat \| Config
- Create: template → name → Documents
- Citations in Chat click through to excerpt / source doc

Desktop: no separate Domain backend; same origin proxy to Fly as today.

## Agent integration

- **4a:** Node type “Query domain” — select Domain, prompt → calls `/ask` (or retrieve-only variant), surfaces citations on canvas/run log
- **4b:** MCP/tools `domain_retrieve` / `domain_ask` bound to same handlers for OpenHands runs

## Observability (light early)

Phase 3+: store per-ask latency; optional token/cost when LiteLLM provides usage. Full trace UI aligns with phase 6–7.

## Mapping from PolyRAG PDF (absorbed over phases)

| PolyRAG idea | Tvashtr phase |
|--------------|---------------|
| Domain as config unit | 1 |
| Ingest / chunk / embed | 2 |
| Cited Q&A | 3 |
| Agent use of corpus | 4a/4b |
| Hybrid + rerank | 5 |
| Eval / golden sets | 6 |
| GraphRAG, multimodal, agentic loops | 7 |
| Production A/B of RAG configs | Deferred (no product A/B UI; eval compares configs offline in phase 6+) |

## Risks

- RAG quality depends on chunking/embed choices — ship eval (phase 6) before claiming production-grade
- pgvector scale — monitor; Qdrant remains an escape hatch if needed later
- Large PDF uploads — size limits + async ingest mandatory
- BYOK required — Domains unusable without embedding (+ chat) keys; UX must say so early

## Open follow-ups (non-blocking)

- Exact embedding model default per template
- File type matrix (pdf/md/txt/html first)
- Object storage for raw files (Fly volume vs Tigris/S3) — decide in phase 2 plan

## Approval record

- Hybrid product + Approach A + hosted-first + pgvector + Domains nav + phased agent node then MCP
- Data model, APIs, UI, phases approved in chat (2026-09-15)
- Web + Desktop parity required
