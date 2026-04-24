# Flux — Personalized Prospect Landing Pages

Flux is a standalone internal tool for generating personalized landing pages for sales prospects. It lives alongside the main app as a gated product island (like Foundry).

## Core Workflows

1. **Build a template** — Define blocks (hero, benefits, case study, testimonial, CTA, social proof, tax strategy calculator), base copy, content assets, and LLM constraints for an offer.
2. **Apply the template for a prospect** — Enter prospect details + brand info (manual), choose a URL slug, hit generate. The LLM personalizes the template into a `PageConfig`, which is rendered at a public URL (`/p/{slug}`).

## Access Control

- Gated by `user_access_flags` with `flag_key = 'flux'`
- Grant: `INSERT INTO user_access_flags (user_id, flag_key) VALUES ('<uuid>', 'flux');`
- Unauthorized users see a generic "Page not found"

## Routes

| Path | Screen |
|------|--------|
| `/flux` | Dashboard (campaign list, recent pages) |
| `/flux/campaigns` | All campaigns |
| `/flux/campaigns/[id]` | Campaign detail + template builder (manual + chat editor) |
| `/flux/prospects` | All prospects |
| `/flux/prospects/new` | Prospect creation + generation form |
| `/flux/prospects/[id]` | Prospect detail + preview + controls |
| `/p/[slug]` | Public prospect page (no auth) |

## Key Decisions (v1)

- **Standalone** — no FK to existing `campaigns` table
- **Manual brand detection** — colors, font, logo entered on prospect form
- **Manual slugs** — user types the slug, system validates uniqueness
- **In-place updates** — regenerating overwrites existing `page_config`
- **No drag-and-drop** — block ordering via move up/down
- **View tracking** — Postgres RPC increments counter on page load

## Tech

- **Database:** 4 tables in main Supabase (`flux_campaigns`, `flux_campaign_templates`, `flux_prospects`, `flux_prospect_pages`)
- **LLM:** Amplify Lambda (`fluxGenerate`) calling [OpenRouter](https://openrouter.ai) chat completions (`/api/v1/chat/completions`) with Zod validation; set secret `OPENROUTER_API_KEY` (`npx ampx sandbox secret set OPENROUTER_API_KEY`). Optional synth env: `FLUX_OPENROUTER_MODEL` (default `anthropic/claude-opus-4.7` in `amplify/backend.ts` and the handler; the undated `anthropic/claude-3.5-sonnet` alias often returns “No endpoints found” on OpenRouter). The Lambda walks a fixed fallback list (Anthropic, OpenAI, Google, Meta, Mistral, DeepSeek, Qwen) when OpenRouter reports no route, HTTP 429/503, or overload/rate-limit style messages. Also: `FLUX_OPENROUTER_HTTP_REFERER`, `FLUX_OPENROUTER_TITLE`. **Structured output:** every request uses OpenRouter `response_format` strict JSON schema for `PageConfig` (from the same Zod as validation); if a model rejects it (HTTP 400/422), the Lambda retries that model once without `response_format`, then continues the normal model fallback chain. **Template fidelity:** after a valid LLM parse, the handler merges output with the campaign template so block `id` / `type` / `order` always match the template; theme and `prospectName` / `companyName` are taken from server-computed brand theme and the prospect, not the model. Empty templates skip the LLM and return an empty `blocks` array.
- **Editor chat:** Amplify Lambda (`fluxEditorChat`) — same auth and Flux flag as `fluxGenerate`; returns structured editor operations validated with Zod. After deploy, `amplify_outputs.json` includes `custom.fluxEditorChatUrl`. Override in Expo with `EXPO_PUBLIC_FLUX_EDITOR_CHAT_URL` if needed. The campaign editor has **Manual** / **Chat** tabs; chat applies edits to the same state as manual controls, with one-step **Undo last chat change**.
- **Types:** `lib/flux/types.ts` (discriminated union for blocks), `lib/flux/schemas.ts` (Zod)
- **UI:** Expo Router + NativeWind, block components in `components/flux/blocks/`
