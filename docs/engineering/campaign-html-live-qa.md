# Campaign HTML Live QA

`Campaign HTML Live QA` exercises the real campaign SMTP worker path with HTML-mode node config.

## Script

Use the fixed QA mailbox sender `porter@furnaceoutbound.com` and queue one of the shared HTML samples:

```bash
npm run send:campaign-html-qa -- --to you@example.com --sample heavy
```

Options:

- `--sample light|medium|heavy`
- `--dry-run`

Required environment:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`
- `SEED_ACCOUNT_ID`
- `SEED_OWNER_USER_ID`

The script creates a throwaway campaign, lead, node, enrollment, and queued `message_job`. The send worker then delivers it through the normal campaign SMTP path.

## Internal UI

Use the internal worker test page at `/(main)/test/worker` and switch `Content Mode` to `HTML live QA`.

Guardrails:

- Sender is locked to the mailbox `porter@furnaceoutbound.com`
- The UI requires an explicit confirmation before queueing the live send
- The HTML sample selector uses the same `light`, `medium`, and `heavy` sample set as the script

## Seed companion

Use the campaign demo seed for preview/debugging without sending live mail:

```bash
tsx scripts/seed/index.ts --scenario=campaign-html-demo
```
