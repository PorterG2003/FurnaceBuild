# Campaign List Page — Mobile-Friendly Mockups

**Scope**: Campaign list page (`/campaigns`) on mobile (width < 768px). Goals: readable, tappable, and consistent with existing tokens (brand orange, grays, Instrument font).

---

## Current State

- **Layout breakpoints**: Page uses `PageLayout` with mobile layout (bottom nav) below 768px. `CampaignCard` uses a “narrow” layout below 600px.
- **Header**: Row with “Campaigns” title, subtitle “Manage your marketing campaigns”, and “New Campaign” button. On small screens the button can feel cramped or the title can wrap awkwardly.
- **Card (narrow)**:
  - **Row 1**: Progress dial (56px) + campaign name + status pill + “Next: …” / created date, plus action tools (Mission Control, Edit, Delete) on the right. This row can overflow or feel tight on very narrow screens (e.g. 320–360px).
  - **Row 2**: Four stat columns in a horizontal row (Sent, Replied, Positive Reply, Bounced). Fixed widths (72–88px each) can cause horizontal squeeze or wrap on small devices.
- **Actions**: Inline in card; delete flows to confirm state (Cancel / Confirm) in the same row.
- **Scroll**: Content is in a `ScrollView` with bottom padding for the floating nav; no pull-to-refresh on the list.

---

## Goals

1. **Single-column, thumb-friendly**: Primary actions and key info visible without horizontal scroll; tap targets ≥ 44pt where possible.
2. **Progressive disclosure**: Lead with name, status, and one primary metric; expose full stats and secondary actions without clutter.
3. **Consistent with app**: Reuse `PageLayout`, bottom nav padding, and existing components (ProgressDial, status pill, modals).
4. **Responsive tiers**: Consider very small (320–375px) vs larger phones (≥ 390px) where the current narrow layout may already be acceptable.

---

## Mockup 1: Page Header (Mobile)

**Problem**: Title + subtitle + “New Campaign” in one row can wrap or shrink on small screens.

**Option A — Stacked**

```
┌─────────────────────────────────────────┐
│  Campaigns                              │
│  Manage your marketing campaigns         │
│                                          │
│  ┌─────────────────────────────────────┐ │
│  │  ＋  New Campaign                    │ │  ← Full-width or near full-width CTA
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

- Title (e.g. `text-2xl`) and subtitle on their own lines.
- “New Campaign” as a full-width or nearly full-width button below (primary orange). Keeps hierarchy and avoids squashing the label.

**Option B — Compact header + floating or inline CTA**

```
┌─────────────────────────────────────────┐
│  Campaigns              [ ＋ New ]      │  ← Icon-only or “New” on very narrow
└─────────────────────────────────────────┘
```

- Single line: title left, compact “New” or “＋ New” button right. Subtitle can be dropped on mobile or moved under the first card.
- **Recommendation**: Prefer Option A for clarity and tap target; use Option B only if you need to maximize space for the list.

---

## Mockup 2: Campaign Card — Very Small Screens (320–375px)

**Problem**: Current narrow layout packs dial + name + status + tools in one row; four stat columns in a second row can feel dense or overflow.

**Suggestion: Vertical stack, primary metric first**

```
┌─────────────────────────────────────────┐
│  ┌───┐  Q1 Outreach          [Running]  │
│  │ ◐  │  Created Mar 12, 2025            │
│  └───┘  Next: Configure schedule…       │  ← Only if draft
│         ─────────────────────────────   │
│  Sent   Replied   Positive   Bounced    │  ← Labels
│   42     12        3          1         │  ← Values (optional: one line with icons)
│         ─────────────────────────────   │
│  [ Mission Control ]  [ ✎ ]  [ 🗑 ]     │  ← Actions on own row, full-width optional
└─────────────────────────────────────────┘
```

- **Row 1**: Progress dial (optional: reduce to 48px on very small) + name (truncate if needed) + status pill. Drop “Next: …” to a second line if draft.
- **Row 2**: Created date.
- **Stats**: Either keep 4 columns with smaller typography and padding, or use a **2×2 grid** (Sent | Replied, Positive | Bounced) so each cell has more room. Alternatively, a single “key metric” row (e.g. “12 replied (29%)”) with “See all stats” linking to campaign detail.
- **Actions**: Own row so they don’t compete with the name. “Mission Control” as full-width primary when draft; Edit and Delete as icon buttons with adequate hit area (padding ≥ 44pt).

**Tap target**: Entire card can remain pressable to open campaign; ensure icon buttons have `hitSlop` or min 44×44.

---

## Mockup 3: Campaign Card — Stats: 2×2 Grid (Mobile)

**Problem**: Four columns in one row use fixed widths and can wrap or feel cramped.

**Option A — 2×2 grid**

```
┌──────────────────────┬──────────────────────┐
│  ✈ Sent              │  ↩ Replied            │
│  42                  │  12 (29%)             │
├──────────────────────┼──────────────────────┤
│  ✓ Positive          │  ⚠ Bounced            │
│  3 (25%)             │  1                    │
└──────────────────────┴──────────────────────┘
```

- Two rows of two stat cells; each cell has icon + label + value (and % when relevant). Fits narrow viewports without horizontal scroll.

**Option B — Single “summary” line + tap for more**

```
  ✈ 42 sent  ·  ↩ 12 replied (29%)  ·  ✓ 3 positive  ·  ⚠ 1 bounced
```

- One scrollable or wrapping line; full stats on campaign detail. Reduces card height at the cost of less at-a-glance detail.

**Recommendation**: Prefer 2×2 grid (Option A) for mobile cards so all four stats remain visible without leaving the list.

---

## Mockup 4: Delete Confirmation (Mobile)

**Current**: Inline Cancel / Confirm in the tools row can be tight and easy to mis-tap.

**Suggestion**: Keep inline but increase touch area and visual weight:

```
┌─────────────────────────────────────────┐
│  Delete “Q1 Outreach”?                   │
│  This cannot be undone.                  │
│                                          │
│  [ Cancel ]        [ Delete campaign ]   │  ← Cancel secondary, Delete destructive
└─────────────────────────────────────────┘
```

- **In-card**: Widen the confirm row; use full-width “Cancel” and “Delete campaign” buttons (stacked on very narrow) with clear destructive styling for Delete.
- **Alternative**: Replace in-card confirm with a **modal** (“Delete campaign?” with Cancel / Delete) so layout stays simple and tap targets are large. Align with existing `BaseModal` patterns.

---

## Mockup 5: Empty & Loading (Mobile)

- **Empty state**: Already uses `EmptyState` with title, description, and “Create Campaign” CTA. Ensure padding and CTA size respect `contentPadding` and bottom nav; CTA full-width or near full-width on mobile is consistent with Mockup 1.
- **Loading**: `CampaignListSkeleton` already has a narrow variant; ensure skeleton cards use the same vertical structure as the proposed mobile card (e.g. dial + lines, then 2×2 stat placeholders, then action row) so there’s no layout shift when content loads.

---

## Mockup 6: Optional Enhancements

1. **Pull-to-refresh**: Add `refreshControl` to the campaigns `ScrollView` so users can refresh the list without leaving the page. Same pattern as other list pages if present.
2. **Sticky “New Campaign”**: On scroll, optionally show a compact FAB or sticky bar with “New Campaign” so the CTA is always available without scrolling back to the header.
3. **Smaller breakpoint for “narrow” card**: Consider lowering the card’s narrow breakpoint from 600px to 480px (or 390px) so tablets in portrait get the wider card layout; reserve the stacked/2×2 layout for phones only.
4. **Safe area**: `PageLayout` already adds bottom padding for the floating nav; ensure left/right padding and any sticky elements respect safe area insets on notched devices.

---

## Summary of Recommendations

| Area            | Recommendation                                                                 |
|-----------------|---------------------------------------------------------------------------------|
| Page header     | Stack title + subtitle + full-width “New Campaign” button (Option A).          |
| Card layout     | On very small width, use vertical stack: dial + name + status, then date, then stats, then actions. |
| Stats           | Use 2×2 grid for the four stats on mobile instead of a single row of four.      |
| Actions         | Put primary (Mission Control) and secondary (Edit, Delete) on their own row; ensure 44pt min tap targets. |
| Delete confirm  | Prefer a short modal over inline confirm; if staying inline, use full-width Cancel / Delete buttons. |
| Skeleton        | Align narrow skeleton with the new card structure to avoid layout shift.       |
| Optional        | Add pull-to-refresh; consider FAB or sticky “New Campaign” when scrolled.      |

---

## Implementation Notes

- **Breakpoints**: `LAYOUT_BREAKPOINT` (768) controls PageLayout (bottom nav). Campaign card uses `NARROW_BREAKPOINT` (600); consider a separate constant for “compact card” (e.g. 400) to switch to 2×2 stats and stacked actions.
- **Components**: Reuse `ProgressDial`, `CampaignStatusPill`, `Tooltip`, and `SmartleadRestrictedModal`; add conditional layout in `CampaignCard` for the new stat grid and action row.
- **Testing**: Verify on 320px and 375px widths (e.g. iPhone SE, narrow Android); confirm bottom nav doesn’t cover the last card and that dial + text don’t overflow.
