# Mobile Style Guide

**Scope**: Mobile layout (width < 768px) and consistent patterns across the app. Reference: `components/ui/layout/constants.ts`.

---

## Breakpoints

- **LAYOUT_BREAKPOINT (768px)**: Layout switch — below this width use bottom nav instead of sidebar. Import from `@/components/ui/layout` or `components/ui/layout/constants.ts`.
- **Optional compact breakpoint (400–480px)**: For list cards, consider a smaller breakpoint (e.g. 400) to switch to 2×2 stats grid or stacked actions on very narrow phones.

---

## Cards

- **Use cards only in list contexts** (e.g. campaign list). Each list item can use the shared card abstraction.
- **Detail/settings pages**: Use **sections with spacing and typography** — no heavy card borders/backgrounds. Prefer plain containers, dividers, and vertical spacing.
- **Single card abstraction**: Use one component with **styled** vs **inline** variant so one implementation works for both. On mobile, use the **inline** (no-style) variant so we don't maintain two implementations per card. Styled = `bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl`; inline = no bg/border, optional padding.

---

## Tap targets

- Minimum **44pt** for primary actions and icon buttons.
- Use `min-w-[44px] min-h-[44px]` (or equivalent) for icon-only buttons so they remain tappable on small screens.

---

## Padding

- **Page/content**: e.g. 24px desktop, 16px mobile for content area horizontal padding.
- **Bottom nav**: Add bottom padding for scrollable content so the floating bottom nav doesn't cover it — use `BOTTOM_NAV_SCROLL_PADDING` from `@/components/ui/layout` (e.g. `paddingBottom: contentPadding + BOTTOM_NAV_SCROLL_PADDING` in ScrollView `contentContainerStyle`).

---

## Typography

- Use **Instrument** font (Instrument Sans). Keep labels and body text readable on small screens; avoid very small body text.

---

## Safe area

- Respect safe area insets for notched devices where applicable (e.g. when using fixed or sticky elements).
