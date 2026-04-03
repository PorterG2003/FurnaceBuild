# Notifications (email received → in-app + Web Push)

## Overview

1. **Inbox checker worker** inserts a row into `notification_events` and sends `{ eventId }` to **SQS** (`furnace-notification-events-{env}`).
2. **Lambda** `processNotificationEvent` (Amplify) consumes the queue, creates **`notifications`** for the mailbox owner, and optionally sends **Web Push** using VAPID.
3. The **app** shows a bell with unread count, **Account → Notifications** for preferences, and registers **push subscriptions** on web.

## Deploy order

1. Apply Supabase migration `20260403120000_notification_system.sql`.

2. **SQS queue** (pick one):

   **A. Production-style (single queue with workers)**  
   Deploy **infra/workers** so CloudFormation exports exist:

   - `FurnaceNotificationEventsQueueArn-{dev|prod}`
   - `FurnaceNotificationEventsQueueUrl-{dev|prod}`

   ```bash
   cd infra/workers && npm run deploy:dev   # or deploy:prod
   ```

   Then deploy Amplify **without** `AMPLIFY_EMBED_NOTIFICATION_QUEUE` (default: import the export above).  
   Set `WORKER_ENVIRONMENT` / `ENVIRONMENT` to `dev` or `prod` to match the worker stack.

   **B. Amplify sandbox without deploying workers**  
   In repo-root `.env.local` (loaded by `amplify/backend.ts`):

   ```bash
   AMPLIFY_EMBED_NOTIFICATION_QUEUE=true
   ```

   Amplify creates its own SQS queue and wires the Lambda. After deploy, `amplify_outputs.json` includes `custom.notificationEventsQueueUrl` if you need to point a local inbox worker at it (optional).

   **C. Explicit queue ARN**  
   Set `AMPLIFY_NOTIFICATION_QUEUE_ARN=arn:aws:sqs:region:account:queue-name` in `.env.local` when you already have a queue ARN (e.g. from the console).

3. Deploy **Amplify** / run `npx ampx sandbox` so the Lambda is subscribed to the chosen queue.

## Secrets (Amplify)

```bash
npx ampx sandbox secret set WEB_PUSH_VAPID_PUBLIC_KEY
npx ampx sandbox secret set WEB_PUSH_VAPID_PRIVATE_KEY
```

Generate keys (e.g. `npx web-push generate-vapid-keys`). Use the **same** public key in the Expo app:

## App env

Add to `.env.local`:

```bash
EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY=<public-key-from-web-push>
```

Optional:

```bash
WEB_APP_ORIGIN=https://build.getfurnace.io
```

Lambda receives `WEB_APP_ORIGIN` at deploy time (defaults to `https://build.getfurnace.io` in `amplify/backend.ts`).

## Local dev without SQS

The inbox worker still inserts `notification_events`. If `NOTIFICATION_QUEUE_URL` is unset (local without ECS env), **no SQS message** is sent; notifications are not processed until you run the Lambda manually or deploy the full pipeline.

## Idempotency

- `notification_events.dedupe_key` unique per account (`email.received:{email_message_id}`).
- `notifications` unique on `(event_id, user_id)`.
