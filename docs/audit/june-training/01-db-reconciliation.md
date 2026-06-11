# Phase 1 — Database Reconciliation

**Campaign:** June Training (`3d6a8efa-c7b0-42e0-8550-56865ef4da9e`)  
**Generated:** 2026-06-11

## 1A. Internal consistency — PASS

| Metric | Count |
|--------|------:|
| `campaign_stats.sent_count` | 3,340 |
| `message_jobs` sent | 3,351 |
| `campaign_stats.replied_count` | 15 |
| `email_threads` with `has_reply` | 15 |
| `events` type `replied` | 15 |

All three reply counters match. Sent count differs slightly (stats vs jobs) — likely timing of stats rollup vs individual job rows; not material to reply detection.

**Provider message IDs:** 0 sent jobs with null `provider_message_id` across all send days.

## 1B. Cohort reply curve (by enrollment first-send day)

| Send day (UTC) | Enrollments sent | With reply | Reply % |
|----------------|----------------:|-----------:|--------:|
| 2026-06-09 | 481 | 15 | **3.12%** |
| 2026-06-10 | 1,447 | 0 | **0.00%** |
| 2026-06-11 | 1,399 | 0 | **0.00%** |

**Expected at Jun 9 rate:** Jun 10–11 cohort (~2,846 enrollments) × 3.12% ≈ **89 replies** if list quality were identical.

**Observed:** 0 replies attributed to Jun 10–11 send cohort. All 15 detected replies belong to Jun 9 send cohort.

## 1C. Sent-without-reply inventory

| Send day | Total sent jobs | Missing provider_id | Enrollments no reply |
|----------|----------------:|--------------------:|---------------------:|
| Jun 9 | 481 | 0 | 466 |
| Jun 10 | 1,447 | 0 | 1,447 |
| Jun 11 | 1,423 | 0 | 1,399 |

## 1D. Detected replies — full inventory (15)

| Lead | Mailbox | Sent (UTC) | Reply received | Ingested | Reply lag (h) | Ingest lag (h) | Category |
|------|---------|------------|----------------|----------|--------------:|---------------:|----------|
| jennijen.harrison@gmail.com | stephanie@mynexttherapistapp.com | Jun 9 16:59 | Jun 9 18:08 | Jun 9 18:13 | 1.1 | 0.1 | Interested |
| rcoloma.grandon@gmail.com | stephanie@nexttherapisttodayapp.com | Jun 9 18:01 | Jun 9 18:12 | Jun 9 18:15 | 0.2 | 0.0 | Interested |
| kristinogdenq@gmail.com | stephanieso@gonexttherapist.com | Jun 9 18:02 | Jun 9 18:56 | Jun 9 19:00 | 0.9 | 0.1 | Neutral |
| karenazareth@gmail.com | sonntag@trynexttherapist.com | Jun 9 19:47 | Jun 9 20:01 | Jun 9 20:05 | 0.2 | 0.1 | Interested |
| skylerporter2112@gmail.com | stephanie@gonexttherapist.com | Jun 9 20:10 | Jun 9 20:10 | Jun 9 20:16 | 0.0 | 0.1 | Interested |
| wreiersen@gmail.com | stephanie@usenexttherapisttoday.com | Jun 9 18:43 | Jun 9 22:33 | Jun 9 22:36 | 3.8 | 0.1 | Interested |
| sbrown1464@gmail.com | stephanie@joinnexttherapist.com | Jun 9 20:07 | Jun 9 22:44 | Jun 9 22:45 | 2.6 | 0.0 | Interested |
| kkravitz@gmail.com | sonntag@mynexttherapist.com | Jun 9 17:00 | Jun 9 23:48 | Jun 9 23:54 | 6.8 | 0.1 | Interested |
| julia.bernards@gmail.com | sonntag@trynexttherapisttoday.com | Jun 9 21:12 | Jun 10 02:03 | Jun 10 02:08 | 4.9 | 0.1 | Interested |
| tyler.lefevor@gmail.com | sonntag@teamnexttherapist.com | Jun 9 22:58 | Jun 10 02:29 | Jun 10 02:34 | 3.5 | 0.1 | Not Interested |
| scottwseaman@gmail.com | sonntag@trynexttherapisttoday.com | Jun 9 22:57 | Jun 10 02:55 | Jun 10 03:00 | 4.0 | 0.1 | Interested |
| vandureng@gmail.com | sonntag@teamnexttherapist.com | Jun 9 19:06 | Jun 10 03:00 | Jun 10 03:00 | 7.9 | 0.0 | Interested |
| **alexaminson@gmail.com** | **stephanieso@mynexttherapisttoday.com** | Jun 9 20:30 | Jun 10 04:53 | **Jun 11 21:17** | 8.4 | **40.4** | Interested |
| **clintcallender6@gmail.com** | **stephanieso@mynexttherapisttoday.com** | Jun 9 19:06 | Jun 10 20:02 | **Jun 11 21:17** | 24.9 | **25.3** | Interested |
| maugustine7512@gmail.com | sonntag@usenexttherapisttoday.com | Jun 9 19:46 | Jun 11 22:03 | Jun 11 22:12 | 50.3 | 0.1 | Interested |

**Late-ingestion proof cases:** Alexa and Clint replies arrived during outage window; ingested ~40h and ~25h after IMAP receipt when checker recovered.

## 1E. June Training mailbox sync (at audit time)

| Metric | Value |
|--------|------:|
| Campaign mailboxes | 64 |
| Connected | 64 |
| Error status | 0 |
| Synced in last 30 min | 64 |
| Stale >30 min | 0 |

## Phase 1 conclusion

- Furnace internal stats are consistent; this is not a UI counting bug.
- **All 15 replies map to Jun 9 send cohort** — Jun 10–11 bulk sends have zero detected replies.
- At native Jun 9 rate, Jun 10–11 cohort would expect ~89 replies; gap is highly suspicious for outage/detection, not yet proven without IMAP ground truth (Phase 3).
