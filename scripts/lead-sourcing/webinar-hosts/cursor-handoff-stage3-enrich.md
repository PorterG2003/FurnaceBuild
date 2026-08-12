# Handoff: Stage 3 — Apollo Enrichment (while Stage 2 runs)

Use this doc in a fresh Cursor session to start **Stage 3** without blocking on the in-flight **Stage 2** LinkedIn scrape.

---

## Pipeline context

| Stage | Status | Command | Output |
|-------|--------|---------|--------|
| 1 — Serper SERP | **Done** | `npm run stage1` | `stage1_linkedin_webinar_posts.csv` |
| 2 — LinkedIn Playwright | **In progress** (~700+/2,979 as of handoff) | `npm run stage2 -- --input ...` | `stage2_linkedin_webinar_posts_extracted.csv` |
| 3 — Apollo enrich | **Next (this handoff)** | `npm run stage3 -- --input ...` | `stage3_webinar_host_entities.csv` |
| 4 — ICP + contacts | After Stage 3 | `npm run stage4 -- --input ...` | `stage4_webinar_host_leads.csv` |

**Repo path:** `scripts/lead-sourcing/webinar-hosts/`

---

## Live run directory

```
output/runs/stage1-live/
├── stage1_linkedin_webinar_posts.csv          # 2,979 URLs (Stage 1 complete)
├── stage1_checkpoint.json                       # status: completed
├── stage2_linkedin_webinar_posts_extracted.csv # growing — partial while Stage 2 runs
├── stage2_checkpoint.json                       # resume pointer (Stage 2)
├── stage2_extraction_log.jsonl
└── pilot/                                     # 20-URL validation run (complete)
    └── stage2_linkedin_webinar_posts_extracted.csv
```

### Stage 2 status (do not restart unless interrupted)

- **Run dir:** `output/runs/stage1-live`
- **Checkpoint/resume:** yes — per-row flush
- **Resume command:**
  ```bash
  npm run stage2 -- --resume output/runs/stage1-live \
    --input output/runs/stage1-live/stage1_linkedin_webinar_posts.csv
  ```
- **Cancel:** Ctrl+C — loses at most 1 URL
- **Quality so far:** ~100% `ok`, 0 blocked, 0 error; all rows use `login_wall_meta_only` (metadata fallback — expected, not a failure)
- **Pace:** ~11–12 sec/URL → ~8–10 hours total

**Important:** Stage 2 and Stage 3 can run in parallel on the same machine, but Stage 3 reads the Stage 2 CSV. Do **not** run full-scale Stage 3 on the partial CSV for production — you'll need to re-run Stage 3 when Stage 2 finishes.

---

## Stage 3 — what it does

**Entry:** `src/stage3-enrich/enrich.ts`

1. Reads Stage 2 CSV rows
2. **Groups by entity** (`author_profile_url` → else `author_name` → else `result_url`)
3. Picks the best post per group (prefers `ok` + non-empty `post_text`)
4. Resolves company via Apollo:
   - **Company posts:** enrich by LinkedIn company URL, then search by name
   - **Person posts:** search person by LinkedIn profile → use employer org
   - **Fallback:** company name from SERP title / slug + domain from registration URLs
5. Optionally analyzes post text via **OpenRouter** (topic, date mention, target audience)
6. Dedupes entities by `apollo_org_id` / domain / company name
7. Writes `stage3_webinar_host_entities.csv`

**Stage 3 has no checkpoint/resume yet.** A killed run must be restarted from scratch.

### Output schema (`stage3_webinar_host_entities.csv`)

| Column | Description |
|--------|-------------|
| `company_name` | Apollo-resolved name |
| `company_domain` | Primary domain |
| `company_linkedin_url` | Company LinkedIn URL |
| `employee_count` | Headcount estimate |
| `industry` | Industry |
| `apollo_org_id` | Apollo org ID |
| `webinar_topic` | OpenRouter extraction (empty if no key) |
| `webinar_date_mention` | OpenRouter extraction |
| `target_audience` | OpenRouter extraction |
| `registration_urls` | Pipe-delimited, merged across posts |
| `sample_post_url` | Best post URL for the entity |
| `post_count` | How many Stage 2 rows mapped to this entity |
| `entity_source` | `company_page` \| `person_employer` \| `serp_fallback` |
| `enrichment_status` | `ok` \| `partial` \| `not_found` |

---

## Environment

Loaded from repo `.env.local` (and package `.env`). Apollo can auto-hydrate from **Amplify SSM** via `ensureEnv()`.

| Variable | Required | Purpose |
|----------|----------|---------|
| `APOLLO_API_KEY` | **Yes** (live) | Org/person enrichment. Auto-loaded from SSM if unset locally |
| `APOLLO_SECRET_TARGET_ENV` | No | `dev` or `prod` SSM prefix (default tries dev, then self-recovery env) |
| `OPENROUTER_API_KEY` | No | Post text analysis (topic/date/audience). Skipped if unset |
| `USE_FIXTURES=1` | No | Zero-cost dev mode |

Stage 3 calls `ensureEnv()` — no Playwright or `LINKEDIN_LI_AT` needed.

---

## Recommended approach (while Stage 2 runs)

### Step 1 — Zero-cost validation ($0)

```bash
cd scripts/lead-sourcing/webinar-hosts
npm test
npm run test:pipeline   # stages 2–4 on fixtures
```

### Step 2 — Live Apollo pilot ($ small)

Use the **completed 20-row pilot** — do not depend on the partial full CSV:

```bash
npm run stage3 -- \
  --input output/runs/stage1-live/pilot/stage2_linkedin_webinar_posts_extracted.csv \
  --output output/runs/stage1-live/pilot/stage3_webinar_host_entities.csv
```

Review output:
- `enrichment_status` distribution (`ok` / `partial` / `not_found`)
- Reasonable `company_name`, `employee_count`, `industry`
- `entity_source` mix (company vs person vs fallback)

Optional dry-run estimate on full eventual input:

```bash
npm run stage3 -- --dry-run --input output/runs/stage1-live/stage2_linkedin_webinar_posts_extracted.csv
```

(Dry-run uses current row count — entity group count printed as `entity_groups`.)

### Step 3 — Paid smoke (optional, ~$0.05–0.20)

```bash
ALLOW_PAID_SMOKE=1 npm run test:smoke
```

Runs Stage 1 (Serper) → 2 → 3 → 4 at smoke limits in a temp dir.

### Step 4 — Full Stage 3 (after Stage 2 completes)

```bash
npm run stage3 -- \
  --input output/runs/stage1-live/stage2_linkedin_webinar_posts_extracted.csv
```

Output defaults to same dir: `output/runs/stage1-live/stage3_webinar_host_entities.csv`

**Cost estimate:** ~1 Apollo org lookup per unique entity group (not per post). With ~2,979 posts, expect fewer groups after dedupe — likely hundreds to low thousands of Apollo calls depending on repeat posters. Budget accordingly before `--confirm-scale` style runs.

---

## Stage 4 preview (after Stage 3)

```bash
npm run stage4 -- \
  --input output/runs/stage1-live/stage3_webinar_host_entities.csv
```

- Filters by **webinar pipeline intent** (Stage 2 post text joined via `sample_post_url`; inclusive denylist in `config/icp.yaml`)
- **Under 100 employees:** broad Apollo search, best contact with email
- **100+ employees:** marketing/sales/growth role search with fallback titles
- Output: `stage4_webinar_host_leads.csv` (emails for outreach)

Or run stages 3+4 together via:

```bash
npm run all -- --from-stage 3 --confirm-scale \
  --resume output/runs/stage1-live
```

(`run-all.ts` wires stage paths under the run dir; Stage 2 must be complete for `--from-stage 3` to use the full Stage 2 CSV.)

---

## Key source files

| File | Role |
|------|------|
| `src/stage3-enrich/enrich.ts` | Stage 3 entry + grouping logic |
| `src/stage3-enrich/apolloClient.ts` | Apollo API wrapper + fixtures |
| `src/stage3-enrich/postAnalyzer.ts` | OpenRouter post analysis |
| `src/stage4-contacts/filterAndFind.ts` | Stage 4 (ICP + contacts) |
| `src/stage4-contacts/icpFilter.ts` | ICP rules |
| `config/icp.yaml` | Headcount, titles, seniority |
| `config/smoke.yaml` | Smoke test limits |
| `src/lib/env.ts` | Env + Apollo SSM hydration |
| `src/lib/types.ts` | CSV schemas |

---

## Acceptance criteria for Stage 3 pilot

- [ ] `npm test` and `npm run test:pipeline` pass
- [ ] Live pilot on 20-row CSV completes without Apollo errors
- [ ] Majority of entities are `ok` or `partial` (not all `not_found`)
- [ ] `company_name` / `employee_count` look plausible on spot-check
- [ ] Dry-run on full Stage 2 CSV prints reasonable `entity_groups` count
- [ ] Full Stage 3 run queued for after Stage 2 `status: completed` in `stage2_checkpoint.json`

---

## Gotchas

1. **Partial Stage 2 CSV** — safe for pilots; not for final Stage 3 output
2. **No Stage 3 checkpoint** — interrupt = restart from scratch
3. **`login_wall_meta_only`** on Stage 2 rows is normal — Stage 3 still gets author/profile/reg URLs
4. **OpenRouter is optional** — Stage 3 works without it; topic fields will be empty
5. **Apollo SSM** — if local key missing, ensure AWS/Amplify credentials can reach SSM dev sandbox
6. **Entity dedupe** — multiple posts from same company → one Apollo call, higher `post_count`

---

## Quick status check commands

```bash
# Stage 2 progress
node --import tsx -e "
import { readFileSync } from 'fs';
const ck = JSON.parse(readFileSync('output/runs/stage1-live/stage2_checkpoint.json','utf8'));
console.log(ck.next_row_index + '/' + ck.total_rows, ck.stats, ck.status);
"

# Is Stage 2 still running?
pgrep -fl extract.ts

# Stage 2 done?
# stage2_checkpoint.json → status: \"completed\"
```

---

## Suggested first message for the new session

> Read `scripts/lead-sourcing/webinar-hosts/cursor-handoff-stage3-enrich.md`. Stage 2 is still running on `output/runs/stage1-live`. Start with the live Apollo pilot on the 20-row pilot CSV, validate enrichment quality, then dry-run the full input. Do not run full-scale Stage 3 until Stage 2 checkpoint shows `completed`.
