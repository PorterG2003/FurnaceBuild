# Notifications (email received → in-app + Web Push)

## Overview

1. **Inbox checker worker** inserts a row into `notification_events` and sends `{ eventId }` to **SQS** (`furnace-notification-events-{env}`).
2. **Lambda** `processNotificationEvent` (Amplify) consumes the queue, creates **`notifications`** for the mailbox owner, and optionally sends **Web Push** using VAPID.
3. The **app** shows a bell with unread count, **Account → Notifications** for preferences, and registers **push subscriptions** on web.

## Multi-account model

- `push_subscriptions` are stored per user + browser device, not per account.
- `notification_preferences` remain per `(user_id, account_id, event_type, channel)` and gate whether a given account may send web push.
- Push deep links include `accountId` so the app can switch to the right account before opening the target thread.

## Inbox deep link URL shape

Thread links use path-based routes:

- `/inbox/{threadId}` — open a conversation (shareable within the current workspace)
- `/inbox/{threadId}?accountId={accountId}` — switch workspace when the user is a member, then open the thread

Legacy links with `?thread=` on `/inbox` are redirected client-side to the path form.

Notification `action_url` values and web push payloads use the path form above.

## Deploy order

1. Apply Supabase migrations:

   - `20260403120000_notification_system.sql`
   - `20260508120000_push_subscriptions_user_scoped.sql`

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
npx ampx sandbox secret set WEB_PUSH_VAPID_PRIVATE_KEY
```

The Lambda reads the VAPID public key from deploy-time env, so only the private key needs to be stored as a secret.

Generate keys (e.g. `npx web-push generate-vapid-keys`). Use the **same** public key in the Expo app and Amplify deploy env:

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
If the VAPID push config is missing or invalid, Web Push is skipped but in-app notification rows are still created.

## Local dev without SQS

The inbox worker still inserts `notification_events`. If `NOTIFICATION_QUEUE_URL` is unset (local without ECS env), **no SQS message** is sent; notifications are not processed until you run the Lambda manually or deploy the full pipeline.

## Idempotency

- `notification_events.dedupe_key` unique per account (`email.received:{email_message_id}`).
- `notifications` unique on `(event_id, user_id)`.

## Manual QA

- Enable push under account A on a browser, switch to account B on the same browser, enable push again, then confirm both accounts still deliver to that browser.
- Click a push notification for a non-active account and confirm the app switches accounts before opening the target inbox thread.
- Revoke browser push permission or let the endpoint expire, then confirm a 404/410 response revokes the stored `push_subscriptions` row.
