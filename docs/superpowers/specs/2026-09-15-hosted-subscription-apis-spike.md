# Spike: Hosted subscription APIs (no cookie relay)

Date: 2026-09-15  
Status: research complete  
Product: Tvashtr (Desktop + Fly microVM hosted runs)  
Related: `2026-09-15-subscription-connect-dual-engine-design.md` (Approach A)

## Question

Can Claude Pro/Max, ChatGPT/Codex, or Grok **consumer subscriptions** be used **legally / officially** for **hosted server-side** agent runs (Fly microVMs) **without** relaying consumer session cookies — i.e. via provider APIs, OAuth, or documented “bring subscription to remote” programs that a SaaS can productize?

## Executive verdict

| Provider | Verdict for Tvashtr-hosted Fly runs | Notes |
|----------|-------------------------------------|--------|
| **Anthropic (Claude Pro/Max)** | **Not available** — use BYOK / OpenRouter / local harness | Consumer OAuth is for Claude.ai / Claude Code (and narrow unmodified-binary hosting). Third parties may not offer Claude.ai login or route Free/Pro/Max credentials on behalf of users; Agent SDK products must use API keys. |
| **OpenAI (ChatGPT Plus/Pro + Codex)** | **Not available** for custom SaaS agent API — use BYOK / OpenRouter / local harness | Subscription powers official Codex clients (CLI/IDE/desktop/Codex cloud) and ChatGPT surfaces. No official “bring Plus/Pro to Platform API for your SaaS.” Enterprise Codex access tokens ≠ general API. |
| **xAI (Grok / SuperGrok)** | **Not available** — use BYOK API key / local harness | Consumer SuperGrok and developer API are separate products. Official hosted use = `XAI_API_KEY` on `api.x.ai`. Unofficial OAuth bridges exist; not an official SaaS entitlement path. |

**Bottom line for Tvashtr:** Keep **Approach A**. Hosted Fly = API keys / OpenRouter / BYOK only. Desktop = local harnesses for subscriptions (October-style). Do **not** relay consumer cookies or subscription OAuth tokens to Fly.

---

## 1. Anthropic Claude — Pro/Max vs API

### Product split

- **Consumer (Free / Pro / Max):** Claude.ai + Claude Code under Consumer Terms; usage limits assume ordinary individual use.
- **Developer / commercial:** Claude Console API keys, Bedrock, Google Agent Platform, Microsoft Foundry — usage-based / commercial agreements.

### Official auth rules (primary)

From Anthropic Claude Code **Legal and compliance** ([code.claude.com/docs/en/legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance)):

- OAuth is **intended exclusively** for Free/Pro/Max/Team/Enterprise purchasers for **ordinary use of Claude Code and other native Anthropic applications**.
- Developers building products/services (including Agent SDK) **should use API key authentication**.
- **Explicit ban:** “Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users.”
- Developers **may not collect, store, or intermediate** Claude.ai credentials or session tokens; sign-in must complete through Anthropic’s own flow.
- Anthropic may enforce **without prior notice**.

### Narrow exception (not “subscription → our API”)

Same doc: platforms may preinstall/run the **unmodified Claude Code binary** under **Commercial Terms**, if:

- Binary is unmodified; auth methods are not stripped.
- Platform does **not** pay for / resell / intermediate usage — **each end user** authenticates with their own API key, Claude subscription, or 3P credential.
- Sign-in still goes through Anthropic’s flow (no Tvashtr-held Claude.ai cookies).

That is **not** equivalent to: “user’s Pro powers Tvashtr’s custom Agent SDK / OpenHands-style harness via a shared subscription token.” A custom Fly agent that calls Anthropic with user Pro OAuth would violate the third-party routing rule.

### Enforcement context (secondary)

Industry reporting (Jan–Feb 2026): Anthropic blocked third-party tools using Max/Pro OAuth; docs clarified Agent SDK + consumer OAuth is not permitted for third-party products. Personal experimentation messaging from Anthropic staff does **not** authorize SaaS intermediating user Pro/Max credentials.

### Verdict (Anthropic)

**Not available** for Tvashtr-hosted custom agent runs via subscription.  
**Local Desktop harness** (user runs Claude Code / local process with their own login) remains aligned with ordinary Claude Code use.  
**Hosted Fly:** BYOK / Console API / OpenRouter only.

---

## 2. OpenAI — ChatGPT Plus/Pro vs API / Codex

### Product split

- **ChatGPT consumer plans:** ChatGPT + included Codex usage on official Codex surfaces; Terms of Use for individuals ([openai.com/policies/terms-of-use](https://openai.com/policies/terms-of-use/)) — accounts are personal; credentials must not be shared.
- **Platform API:** separate Business / API billing (`api.openai.com`). ChatGPT subscription is **not** a Platform API credential.

### Codex auth (primary)

From [developers.openai.com/codex/auth](https://developers.openai.com/codex/auth) and [help.openai.com — Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan):

| Method | What it is | Suitable for Tvashtr Fly SaaS? |
|--------|------------|--------------------------------|
| Sign in with ChatGPT | Subscription-backed Codex in official clients; browser or device-code for headless Codex CLI | **No** as a productized “user Plus → our remote agent API.” Official clients / Codex cloud only. Copying `~/.codex/auth.json` to servers is a personal headless fallback, not a SaaS OAuth program. |
| API key | Platform billing; recommended for CI/CD Codex CLI | **Yes** (BYOK) — not subscription. |
| Enterprise Codex access tokens | Trusted non-interactive **local** Codex workflows; “For general OpenAI API calls, continue to use Platform API keys.” | **No** for general Tvashtr agent API; Enterprise-only and Codex-scoped. |

Codex cloud requires ChatGPT sign-in — that is **OpenAI-hosted** Codex cloud, not “embed subscription into arbitrary Fly microVMs as Tvashtr’s inference backend.”

### “Sign in with ChatGPT” for third-party apps

Partner/beta **identity** OAuth (openid/profile) does **not** grant ChatGPT quota or Platform API spend against the user’s subscription. No public “bring Plus to API” developer program for SaaS inference.

### Verdict (OpenAI)

**Not available** for quit-safe hosted Tvashtr agents powered by user ChatGPT Plus/Pro without cookie/token relay into a non-official client.  
**Local Desktop:** Codex CLI / official harness with user ChatGPT login (October-style) is the supported subscription path.  
**Hosted Fly:** BYOK Platform API / OpenRouter only.

---

## 3. xAI Grok — consumer vs API

### Product split

- **Consumer:** grok.com / apps — Free, SuperGrok (~$30/mo), SuperGrok Heavy, X Premium bundles ([x.ai/pricing](https://x.ai/pricing)).
- **Developer API:** separate console, `XAI_API_KEY`, token pricing on `https://api.x.ai/v1` ([docs.x.ai](https://docs.x.ai/docs/overview), [docs.x.ai/developers/pricing](https://docs.x.ai/developers/pricing)). No consumer subscription required for API; no official “SuperGrok → API credit” bridge for third-party SaaS.

### Unofficial / third-party OAuth

Community agents (e.g. Hermes `xai-oauth`) document device-code OAuth against `accounts.x.ai` to call `api.x.ai` on SuperGrok/X Premium+ quota. That is **third-party reverse-engineering / bridging**, not an xAI-documented SaaS partner API. Reports of **HTTP 403** tier gating underscore instability and product risk.

### Verdict (xAI)

**Not available** officially for hosted SaaS subscription passthrough.  
**Hosted Fly:** BYOK `XAI_API_KEY`.  
**Desktop:** local Grok/CLI harness under user’s own account if they choose; do not productize unofficial OAuth into Fly.

---

## 4. LiteLLM / proxy “subscription bridging” (ToS risk)

| Pattern | What it claims | Risk for Tvashtr |
|---------|----------------|------------------|
| LiteLLM `chatgpt/` provider ([docs.litellm.ai/docs/providers/chatgpt](https://docs.litellm.ai/docs/providers/chatgpt)) | OAuth device flow → ChatGPT Codex backend (`chatgpt.com/backend-api/codex`); use Plus/Pro/Max models via proxy | Uses ChatGPT **subscription backend**, not Platform API. Fine for **personal local** experimentation at user’s own risk; **productizing this on Fly for customers** = unofficial client + account-sharing / automation risk under ChatGPT ToS. |
| LiteLLM Claude Code tutorials | Route Claude Code through LiteLLM with **API keys** / gateway | OK when backend is Console/Bedrock/etc. keys — **not** Claude Pro OAuth. |
| Blog setups “Claude Code via ChatGPT subscription” | Local LiteLLM bridge | Dual ToS exposure (OpenAI consumer backend + Anthropic client expectations). Do not ship. |
| ProxyLLM public stance | Explicitly **refuses** Claude Code subscription support citing Anthropic ban | Confirms industry read of Anthropic policy. |

**Tvashtr policy:** Treat subscription-bridging proxies as **out of scope / high legal risk**. Do not adopt as Approach B for hosted runs.

---

## 5. October Desktop / similar (public positioning only)

[October](https://october.dev/) positions as **infrastructure for supervised multi-agent collaboration**:

- Each agent is a **real process** with its **own harness, provider account, runtime, working directory, tools, and credentials**.
- **32 local harnesses** (Claude Code, Codex, Cursor, Gemini, etc.) — agent-neutral coordinator, not a subscription-as-API reseller.
- Agent work can also run on **connected remote Linux servers**, still as harness processes with **their own** credentials — not “October holds your Claude cookie and bills Anthropic as Pro.”
- Pricing: free local; Pro/Max for October’s own Runs / Cloud — separate from Anthropic/OpenAI/xAI plan entitlements.

**Alignment with Tvashtr Approach A:** Desktop supervises local (or user-owned remote) harnesses; hosted Tvashtr microVMs that Tvashtr operates should not become a cookie/OAuth relay for consumer plans.

---

## ToS / product-risk notes (cross-cutting)

1. **Cookie / session relay to Fly** — Violates Anthropic’s “no collect/store/intermediate Claude.ai credentials” rule; OpenAI “do not share account credentials”; generally indistinguishable from account sharing / unofficial clients. **Hard no.**
2. **Storing user subscription OAuth refresh tokens on Tvashtr servers** for custom agents — Same class of risk as cookies for Anthropic; unsupported for OpenAI Platform; unsupported for xAI SaaS. **Hard no** for Approach A.
3. **Hosting unmodified official CLIs** where the **end user** completes the **provider’s** login inside the VM — Anthropic documents a Commercial Terms path for unmodified Claude Code; OpenAI documents device-auth / auth.json copy for **personal** headless Codex. Both are operationally heavy, quit/session fragile, and still not “subscription = our multi-tenant API.” Defer unless product strategy becomes “remote Claude Code / Codex IDE hosting” under commercial agreements.
4. **Enforcement without notice** — Anthropic already flipped third-party OAuth; LiteLLM/ChatGPT-backend bridges can break anytime. Building hosted revenue on them is a product landmine.
5. **Misleading UX** — Do not imply “Connect Pro” enables quit-safe Fly runs. Dual-engine design already: subscription = local continuity; BYOK = hosted continuity.

---

## Recommendation for Tvashtr

**Keep Approach A (shipping):**

| Surface | Auth |
|---------|------|
| Hosted Fly microVMs (quit-safe) | API keys / OpenRouter / BYOK only |
| Desktop | Local harnesses for Claude / Grok / Codex subscriptions (October-style) |
| Explicitly forbidden | Relaying consumer cookies or subscription tokens to Fly |

**Do not** invest in LiteLLM ChatGPT-subscription bridging or Hermes-style xAI OAuth as a hosted product feature.

### Revisit triggers

Re-open this spike only if **primary provider docs** announce one of:

1. Anthropic: documented OAuth / partner program allowing third-party hosted agents to bill user Pro/Max (or Team) without intermediating forbidden credentials — or a clear “hosted Claude Code unmodified + user OAuth” partner kit Tvashtr can adopt under Commercial Terms.
2. OpenAI: documented “ChatGPT plan → Platform / agent API for third-party SaaS” (not just Codex cloud / official clients / identity OIDC).
3. xAI: documented SuperGrok OAuth for third-party developers with stable entitlements (not community reverse-engineering).

Until then, sales/UX copy: **subscriptions power local Desktop runs; hosted runs need keys.**

---

## Open questions

1. **Anthropic Commercial Terms + unmodified Claude Code in Fly:** Is Tvashtr willing to pivot a hosted SKU to “remote Claude Code VM” (unmodified binary, user completes Anthropic OAuth in-VM, no token intermediating by Tvashtr control plane)? Legal + UX cost vs current BYOK OpenHands-style harness — needs product decision, not just eng.
2. **OpenAI Codex cloud vs Fly:** Could Tvashtr delegate “hosted Codex” to OpenAI Codex cloud (user stays in ChatGPT account) instead of Fly? Different architecture; still not custom Fly agent + Plus.
3. **Enterprise seats:** Team/Enterprise Claude and ChatGPT Business/Enterprise may allow different admin/token stories (e.g. Codex access tokens). Out of scope for consumer Pro/Max spike; track separately if B2B becomes primary.
4. **User-owned remote Linux (October-like):** If Desktop connects to a **customer-controlled** VPS where the user installs Codex/Claude themselves, is that “local harness” or “hosted”? Likely OK if Tvashtr never holds subscription secrets — clarify in dual-engine design.
5. **Counsel review:** This spike is eng/product research from public docs, not legal advice. Before any “hosted subscription” marketing claim, get counsel on Anthropic Consumer vs Commercial Terms and OpenAI consumer ToS.

---

## Evidence index (primary first)

| Source | URL |
|--------|-----|
| Anthropic Claude Code legal & compliance | https://code.claude.com/docs/en/legal-and-compliance |
| OpenAI Codex authentication | https://developers.openai.com/codex/auth |
| OpenAI Help: Codex with ChatGPT plan | https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan |
| OpenAI Terms of Use (individuals) | https://openai.com/policies/terms-of-use/ |
| xAI API overview | https://docs.x.ai/docs/overview |
| xAI API pricing | https://docs.x.ai/developers/pricing |
| xAI consumer pricing | https://x.ai/pricing |
| LiteLLM ChatGPT subscription provider | https://docs.litellm.ai/docs/providers/chatgpt |
| October Desktop positioning | https://october.dev/ |
| ProxyLLM (industry ToS read on Claude OAuth) | https://proxyllm.ai/blog/why-no-claude-code-support/ |

---

## Changelog

- 2026-09-15: Initial spike; verdict = keep Approach A for all three providers.
