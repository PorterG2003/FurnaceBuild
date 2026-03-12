# Remaining TouchableOpacity Usages (Not Secondary Button Style)

These TouchableOpacity usages do **not** match the standard secondary button style (`border border-[#3A3A3A] bg-[#2A2A2A] rounded-xl`, white text) and may need review—e.g. to be replaced with `Button` (another variant), a different component, or left as-is if they are custom controls.

**App location:** Each table includes an **App location (where to find it)** column (and per-section intros) so you can open the app, follow the path (e.g. **Account** → Team → **Change role**), and visually check that each control is grouped and categorized correctly.

---

## Categorization: Standardize via Button Options / New Components

Below, each remaining usage is categorized by **what to add** so they can be standardized. “Use existing” = no Button API change; “New variant/size/component” = proposed addition.


| Category                                             | Description                                                      | Button/component change                                                                                                                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Use existing Button**                              | Can be replaced today with current `Button` API.                 | None. Use `variant="default"` or `variant="secondary"` (and `size="sm"` where appropriate).                                                                                        |
| **New variant: `destructive`**                       | Red, low-emphasis (cancel/remove/revoke).                        | Add `variant="destructive"`: e.g. `bg-red-500/20 border border-red-500/30`, red or muted text. Optional `variant="destructive-solid"` for high-emphasis delete.                    |
| **New variant: `ghost` or `link`**                   | No border/background, text only (e.g. “Select All”).             | Add `variant="ghost"` or `variant="link"`: transparent bg, `text-brand-orange`, hover/active state.                                                                                |
| **New size: `xs`**                                   | Compact row/table actions (e.g. “Change role”, “Unblock”).       | Add `size="xs"`: e.g. `px-2 py-1`, `text-xs`, so secondary/destructive variants don’t look oversized in tables.                                                                    |
| **New component: `IconButton`**                      | Icon-only (or icon + optional label).                            | New `IconButton`: same variants (default, secondary, destructive, outline), sizes (xs, sm, default), and `icon` (+ optional `label`) prop. Replaces ad‑hoc icon TouchableOpacitys. |
| **New component: `LinkButton`**                      | Inline link style (e.g. “Download template CSV”).                | New `LinkButton` or reuse `variant="link"`: no border/bg, brand color text, underline optional.                                                                                    |
| **New component: `ToggleButton` / `SegmentControl`** | One-of-many selection (e.g. unit selector, scenario, test mode). | New `ToggleButton` (single) or `SegmentControl` (group): `selected` state, optional `variant` for unselected (e.g. secondary). Not a single action Button.                         |
| **Keep as custom**                                   | Semantics or layout are not a standard “button”.                 | No change. Use TouchableOpacity or Pressable (e.g. file dropzone, accordion header, checkbox).                                                                                     |


---

## By category (recommended additions)

### Use existing Button (no API change)


| File                                  | Usage                      | App location (where to find it)                                                                                                                                 | Use                                                                                    |
| ------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **TestResultModal.tsx**               | “Close” primary CTA        | **Senders** → Connect/Test a mailbox → after test runs → modal **“Close”** at bottom                                                                              | `<Button onPress={onClose}>Close</Button>` (default variant).                          |
| **SmartleadMigrationWizardModal.tsx** | Pagination Prev/Next       | **Account** → Smartlead Migration → **View Migration** → step 2 (Select campaigns) → **&lt;** and **&gt;** at bottom of table                                   | `<Button variant="secondary" size="sm" onPress={...}>` for both.                       |
| **LeadSourceNodeModal.tsx**           | CSV wizard “Back”, “Reset” | **Campaigns** → open campaign → **Builder** → add/open **Lead source** node → **Configure** → CSV import steps → **Back** and **Reset** in footer                | `<Button variant="secondary" size="sm" ...>` (optionally with `className` for layout). |


### New variant: `destructive`

Use for low-emphasis destructive actions (cancel delete, remove, revoke). Optional second variant for high-emphasis (e.g. “Delete” in a confirm dialog).


| File                           | Usage                                  | App location (where to find it)                                                                                    | Notes                                                                                              |
| ------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| **account.tsx**                | Remove member, Revoke invitation       | **Account** → Team section → each member row **Remove**; Invitations table → each row **Revoke**                    | Row action; pair with `size="xs"` (see below).                                                     |
| **ConfirmDeleteModal.tsx**     | Cancel (outline), Confirm delete (red) | **Senders** → delete mailbox; **Inbox** → delete tag; **Test** → delete campaign → modal **Cancel** / **Delete**   | Cancel → existing `variant="outline"`. Confirm → `variant="destructive"` (or `destructive-solid`). |
| **AICategorizerNodeModal.tsx** | Remove category (trash)                | **Builder** → add/open **AI Categorizer** node → Configure → categories list → **trash icon** per row             | Icon-only destructive → **IconButton** with `variant="destructive"`.                               |


### New size: `xs` (compact row/table actions)

Small padding and text so buttons fit in table rows and tight layouts.


| File                         | Usage                            | App location (where to find it)                                                                 | Notes                                                                        |
| ---------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **account.tsx**              | “Change role”                    | **Account** → Team section → each member row → **Change role**                                  | `Button variant="secondary" size="xs"`.                                      |
| **account.tsx**              | Remove member, Revoke invitation | **Account** → Team → **Remove** per member; Invitations → **Revoke** per row                    | `Button variant="destructive" size="xs"` (after adding destructive).         |
| **ManageBlockListModal.tsx** | Unblock row action               | **Account** → **Manage Block List** → modal → table → **Unblock** in each row                   | `Button variant="secondary" size="xs"` (or a “pending” state if you add it).  |


### New component: `IconButton`

Icon-only or icon + label; same variants/sizes as Button.


| File                                  | Usage                   | App location (where to find it)                                                                                          | Notes                                                                                            |
| ------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| **AICategorizerNodeModal.tsx**        | Remove category (trash) | **Builder** → AI Categorizer node → Configure → trash icon per category row                                              | `IconButton variant="destructive" icon={TrashIcon} />`.                                          |
| **TestResultModal.tsx**               | Close (X)               | **Senders** → Test connection → result modal → **X** top-right                                                           | `IconButton variant="ghost" size="sm" icon={XMarkIcon} onPress={onClose} />` (if you add ghost). |
| **SmartleadMigrationWizardModal.tsx** | Pagination Prev/Next    | **Account** → View Migration → campaign selection step → **&lt;** **&gt;** (same as “Use existing Button” above)         | Could stay as Button with text or become IconButton (chevron) for consistency.                   |
| **ActionButton.tsx**                  | Reusable icon + label   | **Senders** → mailboxes table → each row: **Test**, **Edit** (pencil), **Delete** (trash) icon buttons                   | Replace with `IconButton` with optional `label` prop so all icon actions use one component.      |


### New variant: `ghost` / `link` (or LinkButton)

No border/background; text as link (e.g. brand color).


| File                                  | Usage                         | App location (where to find it)                                                                   | Notes                                                               |
| ------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **SmartleadMigrationWizardModal.tsx** | “Select All” / “Deselect All” | **Account** → View Migration → campaign selection step → **Select All** / **Deselect All** link  | `Button variant="link"` or `<LinkButton>` with `text-brand-orange`. |
| **UploadMailboxesCSVModal.tsx**       | “Download template CSV”       | **Senders** → **Upload CSV** → step 0 → **Download template CSV** under the file picker          | Same; link-style, no box.                                           |


### New component: `ToggleButton` / `SegmentControl`

For “one of many” choices (not a single action). Selected state = primary; unselected = secondary or outline.


| File                          | Usage                              | App location (where to find it)                                                                                    | Notes                                                                                             |
| ----------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **WaitTimeNodeModal.tsx**     | Unit selector (minutes/hours/days) | **Builder** → add/open **Wait time** node → Configure → **minutes** / **hours** / **days** segment               | `SegmentControl` with options and `value` + `onChange`.                                           |
| **worker-race-condition.tsx** | Scenario selector                  | **Test** (nav) → **Worker race condition** → scenario tabs (e.g. “single”, “multi”)                              | Same pattern.                                                                                     |
| **worker.tsx**                | Test mode (single/scale)           | **Test** → **Worker** → **Single** / **Scale** mode toggles                                                       | Same pattern.                                                                                     |
| **EmailPreviewModal.tsx**     | “Missing only” / “All”             | **Builder** → Email node → Configure → **Preview** → **Missing only** / **All** segment (when lead has variables) | Same pattern.                                                                                     |
| **LeadSourceNodeModal.tsx**   | Custom field column pill           | **Builder** → Lead source node → Configure → CSV import → custom fields → pill toggles per column                 | Pill/chip style; could be `ToggleButton` with `shape="pill"` or part of a small `SegmentControl`. |


### Copy / utility actions (secondary or ghost)

Copy-to-clipboard and “show/hide” are still actions; they can use Button or IconButton with a small size.


| File                        | Usage                                                                            | App location (where to find it)                                                                                                                                           | Notes                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **LeadSourceNodeModal.tsx** | Copy endpoint URL, Copy API key, Copy payload example, Toggle API key visibility | **Builder** → Lead source node → Configure → **API** tab: **Copy** next to endpoint URL, **Show/hide** and **Copy** for API key; **Test** tab: **Copy** payload example | `Button variant="secondary" size="sm"` or `IconButton variant="secondary" size="sm"` with Copy/Eye icon. Keeps behavior, standardizes look. |


### Keep as custom (no Button standardization)

Semantics or layout don’t match a standard button; keep TouchableOpacity/Pressable.


| File                                  | Usage                                 | App location (where to find it)                                                                                  | Reason                                                                               |
| ------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **UploadMailboxesCSVModal.tsx**       | File picker area                      | **Senders** → Upload CSV → **Choose CSV File** dashed box (drop zone)                                             | Drop zone / drop target, not a simple button.                                        |
| **SmartleadMigrationWizardModal.tsx** | Expandable section header             | **Account** → View Migration → **Select campaigns** (expandable row header)                                        | Accordion row; could be a dedicated `AccordionTrigger` component later.              |
| **EmailNodeModal.tsx**                | Inline link in Select, “Open preview” | **Builder** → Email node → Configure → subject/body triggers; **Open preview** button                            | Inline custom triggers; optional later: `Button variant="link"` or small IconButton. |
| **components/ui/Checkbox.tsx**        | Checkbox hit area                     | Anywhere a checkbox is used (e.g. forms, toggles)                                                   | Checkbox is its own control; no change.                                               |
| **worker.tsx**                        | Mailbox selector row                  | **Test** → Worker → list of mailboxes to pick one for testing                       | List item selection; could be a list/row component, not a Button.                    |


---

## Summary: recommended Button/component additions

1. **Button**
  - **Variant:** `destructive` (and optionally `destructive-solid` for confirm dialogs).  
  - **Size:** `xs` for compact row/table actions (`px-2 py-1`, `text-xs`).
2. **Button**
  - **Variant:** `link` (or `ghost`) for text-only, brand-color actions (“Select All”, “Download template”).
3. **IconButton** (new component)
  - Props: `icon`, optional `label`, `variant` (default, secondary, destructive, outline, ghost), `size` (xs, sm, default).  
  - Use for: trash, X close, copy, eye, and any icon-only or icon+label action.
4. **SegmentControl** or **ToggleButton** (new component)
  - For single-choice groups: unit selector, scenario, test mode, “Missing only”/“All”, column pills.  
  - API: `options`, `value`, `onChange`, optional `variant` for unselected style.
5. **No new API**
  - Use existing `Button` for: TestResultModal “Close”, wizard Back/Reset/Next, pagination Prev/Next.  
  - Keep as custom: file picker, accordion header, checkbox, mailbox list selection.

---

## app/(main)/account.tsx

**App location:** **Account** (nav) → Account page. Team section (member rows, invitations), Block list (Manage Block List), Smartlead Migration.

| Location | Purpose                      | App location (where to find it)                                              | Style / notes                                                                                                                                                        |
| -------- | ---------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~632     | "Change role" row action     | **Account** → Team → each member row → **Change role**                        | `px-2 py-1 rounded bg-[#2A2A2A] border border-[#3A3A3A]` — compact table action; could be `Button variant="secondary" size="sm"` with smaller padding or left as-is. |
| ~647     | Remove member row action     | **Account** → Team → each member row → **Remove**                             | `px-2 py-1 rounded bg-red-500/10 border border-red-500/20` — destructive action; consider `Button variant` or keep.                                                  |
| ~697     | Revoke invitation row action | **Account** → Invitations table → each row → **Revoke**                        | Same red destructive style as above.                                                                                                                                 |


---

## app/(main)/builder/components/nodeModals/AICategorizerNodeModal.tsx

**App location:** **Campaigns** → open a campaign → **Builder** → add or open **AI Categorizer** node → click to **Configure** → modal: categories list, **Add Category**, trash per row.

| Location | Purpose                 | App location (where to find it)                                    | Style / notes                                                                                            |
| -------- | ----------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| ~142     | Remove category (trash) | **Builder** → AI Categorizer node → Configure → trash icon per row | `p-3 rounded-lg border border-red-500/30 bg-red-500/20` — icon-only destructive; not a secondary button. |


---

## app/(main)/builder/components/nodeModals/EmailNodeModal.tsx

**App location:** **Builder** → add or open **Email** node → **Configure** → modal: subject/body fields (inline actions), **Open preview** button.

| Location   | Purpose                             | App location (where to find it)                                              | Style / notes                                                                                            |
| ---------- | ----------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| ~107       | Inline link/action (e.g. in Select) | **Builder** → Email node → Configure → inline trigger in subject/body field  | `style={{ borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, ... }}` — custom inline style.    |
| ~390, ~432 | "Open preview" action               | **Builder** → Email node → Configure → **Open preview**                      | `style={{ flexDirection: 'row', alignItems: 'center', gap: 6, ... }}` — custom layout; not modal Cancel. |


---

## app/(main)/builder/components/nodeModals/EmailPreviewModal.tsx

**App location:** **Builder** → Email node → Configure → **Preview** (opens modal) → when lead has variables: **Missing only** / **All** segment.

| Location   | Purpose                       | App location (where to find it)                                                    | Style / notes                                                         |
| ---------- | ----------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| ~221, ~237 | Toggle "Missing only" / "All" | **Builder** → Email node → Configure → Preview modal → **Missing only** / **All** | `flex: 1`, `backgroundColor` toggle; segment/tab style, not a button.   |


---

## app/(main)/builder/components/nodeModals/LeadSourceNodeModal.tsx

**App location:** **Builder** → add or open **Lead source** node → **Configure** → API tab (endpoint, API key, copy buttons); CSV import steps (Back, Reset, column pills); Test tab (copy payload).

| Location | Purpose                   | App location (where to find it)                                                                              | Style / notes                                                                                                              |
| -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| ~829     | Custom field column pill  | **Builder** → Lead source → Configure → CSV import → custom field column pills                                | `style={{ borderRadius: 999, paddingHorizontal: 12, ... }}` — pill/chip toggle.                                            |
| ~1003    | Copy endpoint URL         | **Builder** → Lead source → Configure → **API** tab → Copy next to endpoint URL                              | `style={{ borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', ... }}` — copy action.                            |
| ~1030    | Toggle API key visibility | **Builder** → Lead source → Configure → API tab → Show/hide API key                                            | Similar inline style.                                                                                                      |
| ~1043    | Copy API key              | **Builder** → Lead source → Configure → API tab → Copy API key                                                | Same copy-button style.                                                                                                    |
| ~1079    | Copy payload example      | **Builder** → Lead source → Configure → Test tab → Copy payload                                                | Same copy-button style.                                                                                                    |
| ~1179    | CSV wizard "Back"         | **Builder** → Lead source → Configure → CSV import steps → **Back** in footer                                 | `style={{ borderRadius: 12, paddingHorizontal: 16, ... }}` — wizard nav; could be `Button variant="secondary"` if desired. |
| ~1195    | CSV wizard "Reset"        | **Builder** → Lead source → Configure → CSV import steps → **Reset** in footer                               | Same wizard nav style.                                                                                                     |


---

## app/(main)/builder/components/nodeModals/WaitTimeNodeModal.tsx

**App location:** **Builder** → add or open **Wait time** node → **Configure** → **minutes** / **hours** / **days** segment.

| Location | Purpose                            | App location (where to find it)                                              | Style / notes                                                                                                                       |
| -------- | ---------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| ~139     | Unit selector (minutes/hours/days) | **Builder** → Wait time node → Configure → **minutes** / **hours** / **days** segment | `flex-1`, selected = `bg-brand-orange`, unselected = `border-[#3A3A3A] bg-[#2A2A2A]` — toggle group, not a single secondary button. |


---

## app/(main)/test/worker-race-condition.tsx

**App location:** **Test** (nav) → **Worker race condition** → scenario selector tabs.

| Location | Purpose           | App location (where to find it)                    | Style / notes                                                                        |
| -------- | ----------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| ~486     | Scenario selector | **Test** → Worker race condition → scenario tabs    | `px-4 py-2 rounded-lg border`, selected = `bg-brand-orange` — toggle, not secondary. |


---

## app/(main)/test/worker.tsx

**App location:** **Test** (nav) → **Worker** → mailbox list (pick one), **Single** / **Scale** mode toggles.

| Location   | Purpose                          | App location (where to find it)                          | Style / notes                                                   |
| ---------- | -------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| ~437       | Mailbox selector row             | **Test** → Worker → mailbox list (click a row)            | Custom selected state.                                          |
| ~475, ~490 | Test mode (single/scale) toggles | **Test** → Worker → **Single** / **Scale** toggles       | `flex-1 py-3 px-4 rounded-xl border`, selected state — toggles. |


---

## components/account/SmartleadMigrationWizardModal.tsx

**App location:** **Account** → Smartlead Migration → **View Migration** (or Start Migration) → wizard: step 0 (Back), step 1 (Select campaigns — expandable header, pagination, Select All), etc.

| Location   | Purpose                            | App location (where to find it)                                                                                      | Style / notes                                                                                                             |
| ---------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| ~382       | Expandable section header          | **Account** → View Migration → **Select campaigns** (click to expand)                                                 | `px-4 py-4 flex-row items-center justify-between` — accordion row, no border/bg.                                          |
| ~434, ~450 | Pagination Prev/Next               | **Account** → View Migration → campaign selection step → **&lt;** **&gt;** at bottom                                   | `px-3 py-2 rounded-lg border`, `backgroundColor: '#1A1A1A'` — could be `Button variant="secondary" size="sm"` if desired. |
| ~1083      | Wizard "Back"                      | **Account** → View Migration → step 1+ → **Back** in header                                                           | `style={{ borderRadius: 12, ... }}` — wizard nav.                                                                         |
| ~1271      | "Select All" / "Deselect All" link | **Account** → View Migration → campaign selection step → **Select All** / **Deselect All**                            | Text link style (`text-brand-orange`), not a filled button.                                                               |


---

## components/inbox/ManageBlockListModal.tsx

**App location:** **Account** → **Manage Block List** → modal opens → table of blocked entries → **Unblock** per row.

| Location | Purpose            | App location (where to find it)                              | Style / notes                                                                             |
| -------- | ------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| ~132     | Unblock row action | **Account** → Manage Block List → modal → table → **Unblock** | `px-2 py-1 rounded`, conditional `bg-brand-orange/20` or `bg-gray-500/20` — table action. |


---

## components/senders/UploadMailboxesCSVModal.tsx

**App location:** **Senders** → **Upload CSV** → modal: step 0 = file picker + Download template link; step 1 = review/confirm.

| Location | Purpose                 | App location (where to find it)                                        | Style / notes                                                                         |
| -------- | ----------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| ~452     | File picker area        | **Senders** → Upload CSV → **Choose CSV File** dashed area             | `border border-dashed border-white/30 rounded-xl p-6` — drop zone, not a button.      |
| ~463     | "Download template CSV"  | **Senders** → Upload CSV → **Download template CSV** under picker      | `self-start`, `text-[#FF4D00]` — link-style; could stay or use a link/button variant. |


---

## components/senders/ActionButton.tsx

**App location:** **Senders** → mailboxes table → each row: **Test**, **Edit** (pencil), **Delete** (trash) icon buttons.

| Location | Purpose                        | App location (where to find it)                          | Style / notes                                                        |
| -------- | ------------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------- |
| ~46      | Reusable icon (+ label) button | **Senders** → mailboxes table → Test / Edit / Delete     | Custom component with icon, hover; not the standard secondary shape. |


---

## components/senders/TestResultModal.tsx

**App location:** **Senders** → Connect mailbox or Test connection → after test runs, result modal: **X** top-right, **Close** at bottom.

| Location | Purpose               | App location (where to find it)                                          | Style / notes                                                                                       |
| -------- | --------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| ~59      | Close (X) icon button | **Senders** → Test connection → result modal → **X** top-right             | `p-2 -mr-2` — icon only, no border/bg.                                                              |
| ~118     | "Close" primary CTA   | **Senders** → Test connection → result modal → **Close** at bottom        | `py-3.5 rounded-xl bg-brand-orange` — primary button style; could use `<Button>` (default variant). |


---

## components/ui/modals/ConfirmDeleteModal.tsx

**App location:** Used in **Senders** (delete mailbox), **Inbox** (delete tag), **Test** (delete campaign) — modal with **Cancel** and **Delete** (or confirm) buttons.

| Location | Purpose        | App location (where to find it)                                                    | Style / notes                                                                           |
| -------- | -------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| ~77      | Cancel         | **Senders** / **Inbox** / **Test** → delete action → confirm modal → **Cancel**      | `flex-1 px-4 py-3 bg-white/5 border border-white/20 rounded-xl` — outline-style cancel. |
| ~87      | Confirm delete | Same modal → **Delete** (or confirm)                                                | `flex-1 px-4 py-3 bg-red-500/20 border border-red-500/30` — destructive.                |


---

## components/ui/Checkbox.tsx

**App location:** Any screen that uses checkboxes (e.g. forms, settings, multi-select). Shared UI component, not tied to one route.

| Location | Purpose           | App location (where to find it)                    | Style / notes                                      |
| -------- | ----------------- | ---------------------------------------------------- | -------------------------------------------------- |
| ~86      | Checkbox hit area | Anywhere a checkbox is rendered in the app          | Custom checkbox with animated style; not a button. |


---

## components/ui/button.tsx


| Location   | Purpose               | Style / notes                                    |
| ---------- | --------------------- | ------------------------------------------------ |
| (internal) | Button implementation | Uses TouchableOpacity under the hood; no change. |


---

## Summary

- **Converted to secondary Button:** All modal Cancel/Close and "Add Category" that used `border border-[#3A3A3A] bg-[#2A2A2A]` (and the account "Manage Block List" CTA).
- **Remaining:** Row actions (role, remove, revoke, unblock), icon buttons, toggles/segments, copy buttons, file picker, wizard nav, link-style actions, checkbox, and ConfirmDeleteModal footer. Consider standardizing wizard Back/Next and primary "Close" (e.g. TestResultModal) with `Button` where it improves consistency.

