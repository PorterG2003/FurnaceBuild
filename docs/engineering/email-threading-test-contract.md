# Email Threading Test Contract

Executable product rules for Furnace-owned threading. Automated tests assert these
invariants. This document is the source of truth for intended behavior; tests that
contradict it are wrong.

## Subject / conversation rules

1. **Empty subject continues the thread.** A follow-up email step with an empty
   (or whitespace / mistaken `(No subject)` placeholder) subject continues the
   current conversation.
2. **Immediate parent is the latest thread message.** When continuing, the send’s
   `In-Reply-To` is the Message-ID of the most recent message already in that
   thread — whether it was sent by Furnace or received from the lead.
3. **Empty root is valid.** If no prior message exists, an empty-subject first
   step starts a root message with an empty subject. Furnace must not invent or
   persist the UI placeholder `(No subject)` as stored campaign data or as a
   wire subject.
4. **Explicit subject starts a new thread.** A follow-up email step with an
   explicit non-empty subject starts a new conversation and carries no inherited
   `In-Reply-To` / `References` from the previous thread.
5. **Subject epochs.** Each explicit subject creates a new subject/thread epoch.
   Later empty-subject steps inherit the exact rendered subject and ancestry of
   the **newest** epoch, not the campaign’s oldest message.
6. **Spintax resolves once.** Subject spintax is resolved exactly once when a new
   subject/thread starts. The exact delivered result is persisted
   (`message_jobs.message_data.sent_subject`, sent event, `email_messages.subject`)
   and reused by subsequent empty-subject steps without re-spinning.
7. **`(No subject)` is display-only.** The campaign builder may show `(No subject)`
   as a visual placeholder for an empty field. That string must never become
   stored node/variant data or an SMTP subject.

## Priority and manual replies

8. **`campaign_priority` parents the triggering inbound.** Because the inbound
   reply that branched the categorizer is the most recent message in the active
   thread, the priority send’s `In-Reply-To` must equal that inbound’s
   Message-ID (not the last outbound job).
9. **Manual inbox replies parent the selected message.** Composer / API replies
   set `In-Reply-To` to the chosen parent’s Message-ID.

## References and persistence

10. **`References` = parent ancestry + parent Message-ID.** Cumulative, ordered,
    capped by the shared References helper.
11. **Subject surface parity.** Previews, sent jobs, events, Master Inbox rows,
    thread titles, reply/forward composer defaults, and SMTP all expose the same
    resolved subject.
12. **No unresolved templates on the wire.** Delivered or composer subjects must
    not contain unresolved merge/spintax syntax (`{a|b}`).
13. **Persistence parity.** SMTP payload, sent event, `message_jobs`, and
    `email_messages` agree on subject, body text/html, Message-ID, In-Reply-To,
    and References.
14. **MIME semantic parity.** `text/plain` and `text/html` communicate the same
    content.

## Legacy / imported support

15. Legacy or imported rows with missing `events.sent` or missing
    `message_data.sent_subject` remain in the supported matrix. Subject resolution
    must prefer: event `sent_subject` → `message_data.sent_subject` → safe
    rendered fallback — never raw unresolved `node_config.subject` when a
    rendered value exists.

## Confidence boundary

Tests assert Furnace-owned RFC, MIME, persistence, and composer invariants.
They do not send through external mailbox providers.

## Commands

- `npm run test:threading` — required deterministic gate (unit, workers, DB, browser/composer)
- `npm run test:categorizer:live` — optional OpenRouter spend; never part of `test:threading` / `test:campaign:unit`
- Seed for composer QA: `npm run seed -- --scenario=threading-subject-composer`
- Read-only verifier: `npx tsx scripts/seed/scenarios/threading-subject-composer/verify.ts`
