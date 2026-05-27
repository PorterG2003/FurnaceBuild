/** Tooltip copy for saved-list membership review step. */
export const LIST_MEMBERSHIP_REVIEW_HELP = {
  requested:
    'Unique people included in this action. Selection is page-scoped unless you are acting on the full view or list.',
  alreadyMember:
    'People who are already in the target list. They are skipped — saved lists do not store duplicate members.',
  toAdd: 'People who will be added to the list. Only account leads can be added.',
  notInAccount:
    'Requested people who are not in your account rollup. They are skipped and cannot be added to a list.',
  inList: 'People in your selection who are currently members of the target list.',
  toRemove: 'People who will be removed from the list membership.',
  notInList:
    'People in your selection who are not members of the target list. They are skipped on remove.',
  staticList:
    'Saved lists are static snapshots. Adding or removing members does not change who appears in the Leads Explorer when filters change.',
  pageScoped:
    'Bulk actions on selected rows only affect the current page unless you use a view-wide or list-wide action.',
  emptyList:
    'Removing every member leaves an empty list. You can add people again later.',
} as const;
