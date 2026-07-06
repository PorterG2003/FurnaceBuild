# Onboarding announcement art

Announcement-step art shares one chrome component, `AnnouncementArtCard`
(`components/onboarding/art/AnnouncementArtCard.tsx`): a rounded dark card
(`#1A1A1A` on `#2A2A2A` border) with a `#f85102` glow behind a centered
content slot. Two sizes:

- `lg` (16:9) — a real hero image/illustration, for flows worth a bespoke moment.
- `sm` (21:9) — a single centered icon, for lightweight one-sentence announcements.

---

## WelcomeArt (shipped)

**Used in:** `welcome` flow's opening announcement step (`lib/onboarding/flows/welcome.ts`)
**Component:** `components/onboarding/art/WelcomeArt.tsx`
**Size:** `lg`

Wraps the Furnace forge-flame mark (brand orange gradient) in `AnnouncementArtCard`. No headline in the art itself — title/description live in the modal.

### Swap-in for a richer hero

If a fuller illustration is designed later (forge + outbound icons, or a mini command-center mockup — see "Optional (v2)" below), replace the SVG inside `WelcomeArt.tsx` and keep it wrapped in `<AnnouncementArtCard size="lg">` so the card chrome stays consistent. No changes needed in `welcome.ts`.

---

## Icon heroes (shipped)

**Used in:** single/first-step DFY announcement modals (`campaigns`, `senders`, `leads`, `notifications`)
**Factory:** `iconAnnouncementArt(Icon)` in `lib/onboarding/announcementArt.tsx`
**Size:** `sm`

A lightweight alternative to a bespoke illustration: one `react-native-heroicons/outline` icon, colored `#f85102`, centered in `AnnouncementArtCard`. Icons are chosen to match existing app iconography rather than invented fresh:

| Flow | Icon | Matches |
|---|---|---|
| `campaigns` (dfy) | `MegaphoneIcon` | `NavBar.tsx` Campaigns nav item |
| `senders` (dfy) | `EnvelopeIcon` | `NavBar.tsx` Senders nav item |
| `leads` (dfy) | `UserGroupIcon` | `NavBar.tsx` Leads nav item |
| `notifications` | `BellIcon` | `NotificationEventTypeIcon.tsx` default |

To add a new icon hero for another flow, add an export next to the existing ones in `announcementArt.tsx`:

```ts
export const myFlowAnnouncementArt = iconAnnouncementArt(SomeHeroicon);
```

---

## Optional (v2)

For flows that outgrow a single icon and warrant a real illustration (same brief as before, just built on `AnnouncementArtCard size="lg"` instead of a one-off card):

| Asset | Flow | Brief |
|---|---|---|
| `InboxTourArt` | welcome or inbox | Categories rail + thread list mock, one highlighted reply |
| `MetricsTourArt` | metrics | Chart + date range picker callout |

Feature flows are spotlight-only for v1 — art is not blocking.
