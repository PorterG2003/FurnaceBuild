import { View } from 'react-native';
import type { AccountLeadDetail } from '@/lib/leads/types';
import { LeadActivitySection } from '../LeadActivitySection';
import { LeadCampaignsSection } from '../LeadCampaignsSection';
import { LeadConversationsSection } from '../LeadConversationsSection';
import { LeadProfileSection } from '../LeadProfileSection';
import type { LeadDetailSectionId } from './leadDetailMobileSections';
import { LeadDetailMobileNav } from './LeadDetailMobileNav';
import { LeadDetailMobilePageProvider } from './LeadDetailMobilePageContext';

export function LeadDetailMobileView({
  detail,
  accountId,
  section,
  highlightCampaignId,
  onSectionChange,
  onSaved,
  onMembershipChanged,
}: {
  detail: AccountLeadDetail;
  accountId: string;
  section: LeadDetailSectionId | null;
  highlightCampaignId: string | null;
  onSectionChange: (section: LeadDetailSectionId) => void;
  onSaved: () => void;
  onMembershipChanged?: () => void;
}) {
  if (section == null) {
    return <LeadDetailMobileNav detail={detail} onSectionPress={onSectionChange} />;
  }

  return (
    <LeadDetailMobilePageProvider suppressSectionHeader>
      <View className="gap-4">
        {section === 'overview' ? (
          <LeadProfileSection accountId={accountId} detail={detail} onSaved={onSaved} />
        ) : null}
        {section === 'campaigns' ? (
          <LeadCampaignsSection
            accountId={accountId}
            detail={detail}
            highlightCampaignId={highlightCampaignId}
            onMembershipChanged={onMembershipChanged}
          />
        ) : null}
        {section === 'conversations' ? (
          <LeadConversationsSection detail={detail} />
        ) : null}
        {section === 'activity' ? (
          <LeadActivitySection detail={detail} defaultCampaignId={highlightCampaignId} />
        ) : null}
      </View>
    </LeadDetailMobilePageProvider>
  );
}
