# Demo hub — onboarding clips

Expendable seed data for **Porter Gardiner** / **Acme Example Co.** silent onboarding recordings.

## One-time setup

1. Create a dev auth user and account (or reuse your existing seed account).
2. Set in `.env.local`:

```bash
SEED_ACCOUNT_ID=<accounts.id>
SEED_OWNER_USER_ID=<users.id>
SEED_PREVIEW_ORIGIN=http://localhost:8081   # optional, for printed links
```

## Record loop

```bash
npm run seed:demo -- --dry-run    # verify counts + stat targets
npm run seed:demo                 # before recording

# after recording / refresh
SEED_RESET_CONFIRM=1 npm run seed:reset -- --scope=demo-hub
```

## What gets seeded

| Area | What you'll see |
| ---- | ---------------- |
| **Campaigns** | 4 campaigns; running row ~1,800 sent / ~54 replied / ~16 positive |
| **Master Inbox** | ~40 threads, realistic subjects (no QA tags) |
| **Senders** | 30 connected `@demo.furnace.test` mailboxes |
| **Leads** | ~3,000 leads across campaigns |

After a successful seed, the CLI prints deep links including a **hero interested thread** for inbox clips.

## Clip starting points

| Clip | Go to | Look for |
| ---- | ----- | -------- |
| Campaigns overview | `/campaigns` | Mixed statuses, full stat dials on running campaign |
| Inbox list | `/inbox` | Scrollable thread list, unread badges |
| Inbox detail | printed `/inbox/{threadId}` | Interested reply thread |
| Senders | `/senders` | Porter Gardiner + team mailbox names |
