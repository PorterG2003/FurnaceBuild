import { TARGETS, type OnboardingFlowDef } from '../types';

/**
 * Leads power tour — self-serve, desktop only. These are the "you're in a
 * sticky situation" tools DIY users don't discover: build a segment, act on the
 * whole match set across pages, pull a subset out of a campaign or save it as a
 * reusable list, and compile every campaign into one sheet. Fires when the
 * account actually has leads to act on. Not mandatory, no dwell timers.
 *
 * DFY has no entry in the registry map — Furnace manages their lead data, so
 * they never see this tour.
 */
export const leadsFlow: OnboardingFlowDef = {
  id: 'leads',
  version: 6,
  reshowOnVersionBump: true,
  steps: [
    {
      kind: 'spotlight',
      targetId: TARGETS.leadsFilters,
      title: 'Build any segment',
      body: 'Combine campaign, reply status, enrollment state, and tags to isolate exactly the leads you mean.',
      placement: 'bottom',
      advance: 'manual',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.leadsTable,
      title: 'Select across every page',
      body: 'Select all matching leads — not just the rows on this page — so bulk actions hit the whole segment.',
      placement: 'top',
      advance: 'manual',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.leadsActions,
      title: 'Act on the segment',
      body: 'Pause or pull a segment out of a campaign, or save it as a reusable list you can target later.',
      placement: 'bottom',
      advance: 'manual',
    },
    {
      kind: 'spotlight',
      targetId: TARGETS.leadsExport,
      title: 'One sheet, every campaign',
      body: 'Export to compile data across all your campaigns into a single spreadsheet.',
      placement: 'bottom',
      advance: 'manual',
    },
  ],
};
