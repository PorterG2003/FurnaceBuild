import { useCallback, useEffect, useRef, useState } from 'react';
import type { LeadDetailSectionId } from './leadDetailMobileSections';
import { LEAD_DETAIL_SECTION_TITLES } from './leadDetailMobileSections';

export function useLeadDetailMobileNavigation({
  isMobile,
  campaignId,
  displayName,
  email,
  fromInbox,
  onExitPage,
}: {
  isMobile: boolean;
  campaignId: string | null;
  displayName: string;
  email: string | null;
  fromInbox: boolean;
  onExitPage: () => void;
}) {
  const [section, setSection] = useState<LeadDetailSectionId | null>(null);
  const initialDrillDone = useRef(false);

  useEffect(() => {
    if (!isMobile) {
      setSection(null);
      return;
    }
    if (campaignId && !initialDrillDone.current) {
      initialDrillDone.current = true;
      setSection('campaigns');
    }
  }, [campaignId, isMobile]);

  const clearSection = useCallback(() => {
    setSection(null);
  }, []);

  const isDrilled = section != null;

  const headerTitle = isDrilled ? LEAD_DETAIL_SECTION_TITLES[section] : displayName;
  const headerSubtitle = isDrilled ? displayName : email;

  const onBack = isDrilled
    ? clearSection
    : fromInbox
      ? onExitPage
      : undefined;

  return {
    section,
    setSection,
    clearSection,
    isDrilled,
    headerTitle,
    headerSubtitle,
    onBack,
  };
}
