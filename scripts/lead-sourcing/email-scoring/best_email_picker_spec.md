# Best Email Picker — Cursor Handoff Spec

## What this script does
Reads a CSV with three email columns per contact, scores each email, calls the Million Verifier API for business-domain emails, picks the single best email per row, and writes out the full CSV with a new `best_email` column appended.

---

## Input file
`Furnace_4_21_2026_-__Need_to_Call___Florida___Utah___Home_Builders_.csv`

589 rows. Relevant columns:
- `person_name` — format varies: `"Hansen, Ryan K"` or `"Mike Mercer"` or `"Norman Wilson Cannon"`
- `contact_email_1`
- `contact_email_2`
- `contact_email_3`

All other columns pass through untouched.

---

## Output file
Same filename with `_best_email` appended before the extension, e.g.:
`Furnace_4_21_2026_-__Need_to_Call___Florida___Utah___Home_Builders__best_email.csv`

Same columns as input plus one new column at the end: `best_email`

---

## Million Verifier API
- Endpoint: `GET https://api.millionverifier.com/api/v3/`
- Params: `api=YOUR_KEY`, `email=EMAIL`, `timeout=10`
- API key: `8nPHpzIJWcVnZMUIvss6wAeQZ`
- Response field to check: `result`
  - `"ok"` → valid
  - `"catch_all"` → treat as valid (accept it)
  - anything else (`"invalid"`, `"unknown"`, `"disposable"`, etc.) → treat as invalid

Only call the API for **business domain emails** (see definition below). Cache results by email address so you never call the same email twice. Add a small delay between calls (0.2s) to be polite to the API.

---

## Scoring logic

Score each of the three email candidates independently, then pick the highest. If all candidates score 0, `best_email` is blank/empty for that row.

### Step 1 — Dead domain check (score = 0, skip immediately)
If the email's domain is in the dead domain list below, assign score 0 and do not process further.

**Dead domains:**
```
netscape.net, prodigy.net, prodigy.com, webtv.net, wmconnect.com,
excite.com, mailexcite.com, juno.com, worldnet.att.net, collegeclub.com,
address.com, dodgeit.com, lovetestclub.com, goennounce.com, angelfire.com,
altavista.com, blackplanet.com, iwon.com, lycos.com, myway.com, go.com,
adelphia.net, adelphia.com, attbi.com
```

### Step 2 — Classify domain as business or consumer

**Known consumer/ISP domains** (treat as consumer):
```
gmail.com, yahoo.com, yahoo.es, ymail.com, hotmail.com, hotmail.co.uk,
aol.com, aol.ocm, msn.com, live.com, outlook.com, icloud.com, me.com,
mac.com, comcast.net, comcast.com, att.net, att.com, bellsouth.net,
bellsouth.com, sbcglobal.net, verizon.net, verizonwireless.com,
earthlink.net, mindspring.com, cox.net, charter.net, roadrunner.com,
tampabay.rr.com, cfl.rr.com, twcny.rr.com, nc.rr.com, rochester.rr.com,
austin.rr.com, cinci.rr.com, nycap.rr.com, triad.rr.com, pacbell.net,
ameritech.net, qwest.net, qwestoffice.net, windstream.net, frontier.com,
frontiernet.net, centurylink.net, tds.net, alltel.net, allwest.net,
wildblue.net, wildblue.ne, cableone.net, epix.net, 3rivers.net,
zoominternet.net, wowway.com, optonline.net, mediaone.net, mchsi.com,
attglobal.net, embarqmail.com, ptd.net, netzero.net, netzero.com,
cs.com, mail.com, gmx.com, inbox.com, aim.com, usa.net, hitter.net,
gte.net, ubtanet.com, concentric.net, execpc.com, inet-1.com,
supanet.com, peganet.com, gci.net, dishmail.net, fi.com, itsnet.com,
3rivers.net, mpoweryou.net, ihavenet.com, intellistar.net, tivo.com,
zebra.net, q.com, flash.net, fla.com, htn.net, cpaz.net, dncs.net,
cfi.net, wfrmls.com
```

Anything NOT on the consumer list and NOT on the dead list = **business domain**.

### Step 3 — Score each email

Start at 0, apply rules in order:

| Rule | Points |
|------|--------|
| Business domain (before MV check) | +50 |
| Business domain but MV returns invalid/unknown | −60 (net negative, effectively excluded) |
| Consumer domain | +20 |
| Role-based local part (see list below) | −15 |
| Name match in local part (see logic below) | +15 |
| Column position tiebreaker: email_1 | +2 |
| Column position tiebreaker: email_2 | +1 |
| Column position tiebreaker: email_3 | +0 |

**Role-based prefixes** (check if local part — the part before @  — starts with or exactly equals any of these):
```
info, office, admin, sales, contact, support, hello, mail, noreply,
no-reply, webmaster, billing, help, team, service, enquiries,
enquiry, inquiry, general, reception, accounts, operations
```

**Name match logic:**
- Parse `person_name` into tokens. Handle both `"Last, First Middle"` and `"First Middle Last"` formats.
- Extract first name and last name only (ignore middle).
- Lowercase both the name tokens and the local part of the email.
- If either first name or last name appears as a substring in the local part → +15.
- Only award +15 once even if both match.

### Step 4 — Pick winner
- Take the email with the highest score.
- If the top score is 0 or below → `best_email` = empty string.
- If there's a tie after all scoring (including tiebreaker), take email_1 > email_2 > email_3.

---

## Implementation notes

- Use `pandas` to read/write the CSV.
- Use `requests` for Million Verifier calls.
- Cache MV results in a dict keyed by email string (many contacts may share a business domain email).
- Print progress to console every 50 rows so you can see it's running.
- The MV API should only be called for business-domain emails that survive the dead-domain filter. Don't call it for consumer emails — we don't need to verify those here, MV will be run on the final output list separately.
- Preserve all original columns and column order. Append `best_email` as the last column.
- Handle NaN/empty email cells gracefully — treat as no candidate.

---

## Quick sanity check examples

| person_name | email_1 | email_2 | email_3 | expected best_email |
|---|---|---|---|---|
| Gagne, Patrick M | gagnepat@yahoo.com | patrick@pmgconstructioncorporation.com | pmgweb3@aol.com | patrick@pmgconstructioncorporation.com (business, MV-verified) |
| Ionta, Kevin | jlionta@gmail.com | evbrunner@aol.com | kevinionta@gmail.com | kevinionta@gmail.com (name match on consumer) |
| McDonald, Daniel | sb2837@att.net | sb2837@worldnet.att.net | sb2837@bellsouth.net | sb2837@att.net (worldnet.att.net is dead, all consumer, col order tiebreak) |
| Bethea, Claude W | claudeb105@aol.com | s7cbethea@netscape.net | claude@exploreinteractive.com | claude@exploreinteractive.com (business, MV-verified; netscape.net dead) |
| Brice Sadler | NaN | NaN | NaN | (empty) |
