# Connection Pooling Explained

## What is Nodemailer?

**Nodemailer** is a Node.js library for sending emails. It handles all the low-level SMTP (Simple Mail Transfer Protocol) communication - the technical protocol that email servers use to send emails to each other.

Think of it like this:
- **Without nodemailer**: You'd have to manually write code to connect to email servers, send SMTP commands, handle authentication, etc. (very complex)
- **With nodemailer**: You just say "send this email" and it handles all the SMTP protocol stuff for you

## What is a Transporter?

A **transporter** is nodemailer's way of representing a connection to an email server (like Gmail, Outlook, or a custom SMTP server).

When you create a transporter, you give it:
- SMTP server address (e.g., `smtp.gmail.com`)
- Port number (e.g., `465` or `587`)
- Username and password for authentication
- Security settings (SSL/TLS)

The transporter then knows how to connect to that specific email server.

## Current Code Pattern

Looking at your current code (`workers/send-worker/src/worker.ts` line 178):

```typescript
// For EACH email sent, a NEW transporter is created
const transporter = createTransporter(mailbox);
await sendEmail(transporter, mailbox, messageJob, lead, subject, emailBody);
```

This means:
- Worker sends email #1 → creates transporter → sends → transporter is discarded
- Worker sends email #2 → creates transporter → sends → transporter is discarded
- Worker sends email #3 → creates transporter → sends → transporter is discarded

**Problem**: Creating a new connection to the SMTP server for every email is slow and wasteful.

## What is Connection Pooling?

**Connection pooling** means reusing the same SMTP connection to send multiple emails, instead of creating a new connection each time.

Think of it like this:
- **Without pooling**: Every time you want to send mail, you drive to the post office, send one letter, drive home, then repeat for the next letter
- **With pooling**: You drive to the post office once, send all your letters while you're there, then drive home

Nodemailer supports connection pooling! When you create a transporter with `pool: true`, it will:
- Keep SMTP connections alive
- Reuse the same connection for multiple emails
- Manage the connection lifecycle automatically

## The Issue in the Completion Plan

The completion plan mentions "connection pooling" but the current code doesn't actually pool connections because:

1. **A new transporter is created for every email** (line 178 of worker.ts)
2. Even though each transporter has `pool: true` configured, you're creating a new transporter each time
3. Each transporter starts with an empty pool, so you're not actually reusing connections

## The Question in COMPLETION_PLAN_REVIEW_NOTES.md

The question is: **How should we implement connection pooling?**

**Option 1: Cache transporters in the worker**
- Create transporter once per mailbox
- Store it in a Map: `Map<mailbox_id, transporter>`
- Reuse the same transporter for multiple emails from the same mailbox

**But there are questions:**
- Do we need to explicitly close transporters when done? (Nodemailer can manage this automatically)
- Should we check if the connection is still healthy before using it?
- What happens if a transporter gets into a bad state? (Should we detect and recreate it?)

**Option 2: Let nodemailer manage pooling per transporter**
- Keep creating new transporters (current behavior)
- But nodemailer's internal pooling still helps if you send multiple emails through the SAME transporter instance before discarding it
- Less efficient, but simpler

## Current Status

**Right now**:
- Transporter created per email → discarded after sending
- Nodemailer has `pool: true` configured, but it's not helpful because the transporter is discarded immediately
- No actual connection pooling happening

**What needs clarification**:
- Should we cache transporters in the worker to actually reuse connections?
- Or is the current simple approach (create new transporter per email) acceptable?
- If we cache, how do we manage transporter lifecycle (health checks, cleanup, etc.)?

---

## Simple Answer

**Nodemailer**: Library that sends emails  
**Transporter**: Connection to an email server (created by nodemailer)  
**Connection Pooling**: Reusing the same connection for multiple emails (faster, more efficient)  
**Current Problem**: Creating a new transporter for every email, so no pooling benefits  
**Question**: Should we cache transporters to enable pooling, or keep the simple approach?
