import { namecase } from '@compwright/namecase';
import { classifyOwnerName, type OwnerKind } from './ownerDrilldown.js';

export type FormattedOwnerName = {
  cleanName: string;
  displayName: string;
  ownerKind: OwnerKind;
};

export function formatOwnerDisplayName(ownerName: string): FormattedOwnerName {
  const cleanName = ownerName.replace(/\s+/g, ' ').trim();
  if (!cleanName) {
    return {
      cleanName: 'Unknown',
      displayName: 'Unknown',
      ownerKind: 'unknown',
    };
  }

  const { kind } = classifyOwnerName(cleanName);
  return {
    cleanName,
    displayName: kind === 'person' ? namecase(cleanName) : cleanName,
    ownerKind: kind,
  };
}
