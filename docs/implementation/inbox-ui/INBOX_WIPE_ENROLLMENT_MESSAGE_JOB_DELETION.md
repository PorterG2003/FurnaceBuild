# Where enrollments and message_jobs get deleted

This doc answers: **where in the codebase do we delete enrollments or message_jobs?** (Relevant to master inbox wipe, since `email_threads` had CASCADE from both.)

## Short answer

- **We do not** explicitly delete from `enrollments` or `message_jobs` anywhere in application or worker code.
- They are only removed by **database CASCADE** when a parent row is deleted (campaign or lead).

---

## 1. No direct deletes in app/workers

Searches over the repo show:

- **No** `.from('enrollments').delete()` in any `.ts`/`.tsx`/`.js` file.
- **No** `.from('message_jobs').delete()` in any `.ts`/`.tsx`/`.js` file.

So no UI, API, or worker ever runs a direct DELETE on those two tables.

---

## 2. Where CASCADE deletes come from

Deletes that **do** happen and that cascade to enrollments/message_jobs (and previously to email_threads) are:

### 2.1 Campaign delete (only place that deletes message_jobs)

| Location | What runs |
|----------|-----------|
| `lib/supabase/services/campaigns.ts` | `deleteCampaign(id)` – `.from('campaigns').delete().eq('id', id)` |
| `lib/supabase/services/campaigns.ts` | `deleteTestCampaign(campaignId)` – same campaign delete after optional mailbox deletes |

**Callers:**

- `deleteCampaign`: **`app/(main)/campaigns.tsx`** → `handleDeleteCampaign(id)` (Campaigns list page).
- `deleteTestCampaign`: **`app/(main)/test/campaigns.tsx`** → when deleting a test campaign.

When a campaign row is deleted, Postgres CASCADE deletes (among others):

- `leads` (where `campaign_id` = that campaign)
- `enrollments` (where `campaign_id` = that campaign)
- `message_jobs` (where `campaign_id` = that campaign)

So **all enrollment and message_job rows for that campaign** are removed by CASCADE, not by any explicit delete in our code.

### 2.2 Lead delete (deletes enrollments for that lead)

| Location | What runs |
|----------|-----------|
| `lib/supabase/services/leads.ts` | `hardDeleteLead(id)` – `.from('leads').delete().eq('id', id)` |

**Callers:**

- **None.** `hardDeleteLead` is not called from any other file (no UI, no API, no script in this repo).

When a lead row is deleted, Postgres CASCADE deletes:

- `enrollments` (where `lead_id` = that lead)
- Then `message_jobs` that reference those enrollments (via `enrollment_id`) are also deleted by CASCADE from `enrollments`.

So **enrollment/message_job** (and previously thread) removal can happen when a **lead** is deleted, but in this codebase that only happens if something calls `hardDeleteLead` – and nothing does.

---

## 3. Documented cleanup (not implemented)

In **`docs/implementation/testing/TEST_SYSTEM_FIXES.md`** there is a *proposed* “Cleanup Test Data” flow that would:

1. `message_jobs.delete().eq('enrollment_id', enrollmentId)`
2. `enrollments.delete().eq('id', enrollmentId)`
3. Then nodes, leads, campaign.

That cleanup is described for a file `app/(main)/test/scheduler.tsx`; that file does **not** exist in the repo, and no other code implements this sequence. So there is **no** live path that explicitly deletes enrollments or message_jobs.

---

## 4. Summary table

| Table          | Explicit delete in code? | Deleted only by CASCADE when…        |
|----------------|--------------------------|--------------------------------------|
| `enrollments`  | **No**                   | Campaign deleted, or lead deleted   |
| `message_jobs` | **No**                   | Campaign deleted (or enrollment deleted by lead/campaign delete) |

So if the inbox was wiped by enrollment/message_job CASCADE, the only triggers in this codebase would be:

1. **Campaign delete** – Campaigns page or Test campaigns page (you said no campaigns were deleted), or  
2. **Lead delete** – would require something to call `hardDeleteLead` (nothing does in this repo), or  
3. **External action** – e.g. Supabase dashboard (delete campaign/lead), one-off SQL, or another service/tool.

The migration that sets `email_threads` FKs (e.g. `enrollment_id`, `message_job_id`) to `ON DELETE SET NULL` prevents future inbox wipes from enrollment/message_job (and campaign/lead) deletion; it does not change where those deletes happen in the codebase.
