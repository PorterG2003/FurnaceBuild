# Message Panel — Mockups & Redesign

**Parent**: [MASTER_INBOX_UI_PLAN.md](./MASTER_INBOX_UI_PLAN.md)  
**Scope**: Message panel only (right side of inbox). Thread panel and composer are out of scope for this doc.

---

## Current state / problems

- **Header**: Subject + participants + Reply; cramped, no clear primary action hierarchy.
- **Messages**: Flat list; sent vs received only distinguished by a small “Sent” badge. No visual separation (bubbles, alignment, background).
- **No date grouping**: All messages in one scroll; no “Today”, “Yesterday”, “Monday” dividers.
- **No avatars**: Sender is text only; no initials or avatar for quick scan.
- **Body**: Plain text only; long messages are one block; no expand/collapse or max height.
- **No message-level actions**: Reply is global; no “Reply to this message”, forward, copy, etc. on each message.
- **Density**: Same padding for every message; no rhythm between messages vs date breaks.
- **Empty/loading**: Functional but not distinctive.

---

## Goals

1. **Clear sent vs received**: Visually separate “them” vs “us” (e.g. left-aligned vs right-aligned, or distinct backgrounds).
2. **Scannable**: Date dividers, sender prominence, short preview or expand for long bodies.
3. **Consistent with app**: Use existing tokens (brand orange, grays, Instrument font, spacing).
4. **Actionable**: Primary Reply in header; optional message-level actions later.
5. **Responsive**: Works when panel is narrow (e.g. collapse thread list).

---

## Mockup 1: Message panel — high-level layout

```
┌─────────────────────────────────────────────────────────────────┐
│  MESSAGE PANEL (right side)                                     │
├─────────────────────────────────────────────────────────────────┤
│  HEADER (sticky)                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Re: Project follow-up                    [ Reply ]     │    │
│  │  sarah@co.com, you@furnace.build                         │    │
│  └─────────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│  MESSAGE LIST (scrollable)                                       │
│                                                                  │
│  ───────────────  Today  ───────────────                          │
│                                                                  │
│  ┌─ RECEIVED (left / neutral bg) ─────────────────────────┐     │
│  │  [SJ]  Sarah Johnson  sarah@co.com     Today, 2:34 PM   │     │
│  │        Thanks for the update. Can we schedule a call?   │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
│  ┌─ SENT (right / subtle brand or gray) ──────────────────┐     │
│  │         Today, 3:12 PM  you@furnace.build  [You]        │     │
│  │        Sure, how about Tuesday at 10?                   │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
│  ───────────────  Yesterday  ───────────────                      │
│                                                                  │
│  ┌─ RECEIVED ──────────────────────────────────────────────┐    │
│  │  [SJ]  Sarah Johnson  ...            Yesterday, 4:00 PM │     │
│  │        Hi, checking in on the proposal...               │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Mockup 2: Header (sticky)

- **Row 1**: Subject (single line, truncate) + primary action **Reply** (button, brand orange).
- **Row 2**: Participants (emails or “Name \<email\>”), secondary text (gray), single line truncate or wrap.
- **Height**: Compact (e.g. 2 lines + padding). Border below.

```
┌──────────────────────────────────────────────────────────────┐
│  Re: Project follow-up                         [ Reply ]      │
│  Sarah Johnson <sarah@co.com>, you@furnace.build              │
└──────────────────────────────────────────────────────────────┘
```

---

## Mockup 3: Date divider

- Centered label: “Today” | “Yesterday” | “Monday, Jan 27” | “Jan 15, 2026”.
- Light rule or pill background so it doesn’t compete with messages.
- Consistent vertical margin above/below.

```
         ─────────────  Today  ─────────────
```

or

```
    ·················  Yesterday  ·················
```

---

## Mockup 4: Received message (left / “them”)

- **Layout**: Row 1 = avatar (initials) + name + email (optional) + time. Row 2 = body.
- **Avatar**: Circle with initials (e.g. “SJ”), neutral bg (e.g. #2A2A2A), left-aligned.
- **Block**: Optional subtle background (e.g. #1A1A1A) or just left-aligned with a vertical accent (thin brand or gray line).
- **Body**: Plain text; limit height with “Show more” if long (e.g. max 6 lines).

```
┌─────────────────────────────────────────────────────────────────┐
│  [SJ]  Sarah Johnson                    Today, 2:34 PM           │
│        sarah@co.com                                              │
│                                                                  │
│        Thanks for the update. Can we schedule a call for        │
│        next week?                                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Mockup 5: Sent message (right / “us”)

- **Layout**: Mirror of received: time + email (optional) + “You” (or mailbox name) + avatar (optional).
- **Block**: Right-aligned; distinct background (e.g. #252525 or very subtle orange tint) so “our” messages pop.
- **Avatar**: Optional “You” initials or icon on the right.

```
┌─────────────────────────────────────────────────────────────────┐
│           Today, 3:12 PM  you@furnace.build  [You]              │
│                                                                  │
│        Sure, how about Tuesday at 10? I’ll send a calendar       │
│        invite.                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Mockup 6: Message list rhythm (vertical spacing)

- **Between messages (same day)**: e.g. 12–16px gap.
- **Above/below date divider**: e.g. 16–24px so dates don’t feel cramped.
- **First message below header**: e.g. 16px top padding.
- **Last message**: Extra bottom padding so Reply (if we add a sticky reply bar later) doesn’t cover content.

---

## Component breakdown (suggested)

| Component | Responsibility |
|-----------|----------------|
| **MessagePanel** | Wrapper: header + scrollable list. Handles empty state (“Select a conversation”), loading, error. |
| **MessagePanelHeader** | Subject, participants, Reply button. Sticky. |
| **MessageList** | ScrollView; groups messages by date; renders DateDivider + MessageBubble. |
| **DateDivider** | Centered label “Today” / “Yesterday” / date. |
| **MessageBubble** | One message: received (left) vs sent (right), avatar, sender, time, body. Optional “Show more” for long body. |

---

## Visual tokens (align with existing app)

- **Background**: Panel #121212; message blocks received #1A1A1A or none; sent #252525 or subtle orange/20.
- **Borders**: #2A2A2A.
- **Primary action**: Brand orange (#F3440D or token).
- **Text**: White primary; gray-400 secondary (email, time); gray-500 tertiary (date divider).
- **Font**: Instrument (existing).
- **Avatar**: BG #2A2A2A or #333; text white; size ~32–40px.

---

## Out of scope for this pass

- Thread panel redesign.
- Reply composer redesign (stays modal for now).
- Message-level actions (Reply to this, Forward, Copy).
- HTML body rendering (keep plain text / stripped HTML for now).
- Attachments in message body.
- Collapse thread list on narrow width (can be a follow-up).

---

## Next step

Implement the message panel to match Mockups 1–6: header (Mockup 2), date grouping (Mockup 3), MessageBubble sent vs received (Mockups 4–5), spacing (Mockup 6). Extract **MessagePanelHeader**, **DateDivider**, **MessageBubble** (or **MessageItem** with direction-based layout) and use them inside the existing inbox page.
