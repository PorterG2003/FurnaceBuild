# Flux Database Schema

Source migration: [`20260423120000_flux_tables.sql`](../../supabase/migrations/20260423120000_flux_tables.sql)

## Tables

### `flux_campaigns`

One row per offer/campaign.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `account_id` | uuid FK → accounts | |
| `name` | text | |
| `offer_description` | text | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | auto-trigger |

### `flux_campaign_templates`

1:1 with campaign (UNIQUE on `campaign_id`). Contains the block layout, content assets, and LLM config.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `campaign_id` | uuid FK → flux_campaigns | UNIQUE |
| `blocks` | jsonb | `Block[]` discriminated union |
| `content_assets` | jsonb | `ContentAsset[]` |
| `copy_slots` | text[] | Field names LLM may rewrite |
| `constraints` | text | Free-form rules for LLM |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | auto-trigger |

### `flux_prospects`

One row per prospect (person at a company you're targeting).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `account_id` | uuid FK → accounts | |
| `campaign_id` | uuid FK → flux_campaigns | |
| `name` | text | Contact name |
| `company` | text | |
| `role` | text | |
| `url` | text | Company website |
| `industry` | text | |
| `company_size` | text | |
| `email_notes` | text | Pasted email thread context |
| `brand_profile` | jsonb | `BrandProfile` (manual in v1) |
| `created_at` | timestamptz | |

### `flux_prospect_pages`

The generated page for a prospect. Served publicly at `/p/{slug}`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `prospect_id` | uuid FK → flux_prospects | |
| `campaign_id` | uuid FK → flux_campaigns | |
| `account_id` | uuid FK → accounts | |
| `slug` | text | UNIQUE, user-provided |
| `page_config` | jsonb | `PageConfig` (blocks + theme + copy) |
| `status` | text | `draft` / `live` / `archived` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | auto-trigger |
| `published_at` | timestamptz | Set when status → live |
| `last_viewed_at` | timestamptz | Updated by RPC |
| `view_count` | int | Incremented by RPC |

## RLS

- `flux_campaigns`, `flux_campaign_templates`, `flux_prospects`: authenticated CRUD scoped to account via `account_users`
- `flux_prospect_pages`: same for authenticated; anon can SELECT where `status = 'live'`

## RPC

- `flux_increment_page_view(p_slug text)` — SECURITY DEFINER, increments `view_count` and sets `last_viewed_at` for live pages. Callable by anon.
