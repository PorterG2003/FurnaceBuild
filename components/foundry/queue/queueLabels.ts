export function reviewTaskTitle(taskType: string): string {
  switch (taskType) {
    case 'source_link_review':
      return 'Link source row to company';
    case 'entity_match_review':
      return 'Confirm entity match';
    case 'company_dedupe':
      return 'Company dedupe';
    case 'entity_owner_dedupe':
      return 'Contact dedupe';
    case 'parse_failure':
      return 'Parse failure';
    default:
      return taskType;
  }
}
