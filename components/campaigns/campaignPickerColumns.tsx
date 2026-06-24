import { Text } from 'react-native';
import type { TableColumn } from '@/components/ui/DataTable';
import { CampaignStatusPill } from './CampaignStatusPill';
import type { CampaignListSummary } from '@/lib/supabase/services/campaigns/campaign-list-summary';

export function buildCampaignPickerColumns(): TableColumn<CampaignListSummary>[] {
  return [
    {
      key: 'name',
      label: 'Campaign',
      flex: 2,
      minWidth: 180,
      render: (campaign) => (
        <Text className="text-sm text-white font-instrument-medium" numberOfLines={1}>
          {campaign.name}
        </Text>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      flex: 1,
      minWidth: 100,
      render: (campaign) => <CampaignStatusPill status={campaign.status} />,
    },
    {
      key: 'enrollmentCount',
      label: 'Leads',
      flex: 1,
      minWidth: 80,
      render: (campaign) => (
        <Text className="text-sm text-gray-300">{campaign.enrollmentCount.toLocaleString()}</Text>
      ),
    },
    {
      key: 'contactedEnrollmentCount',
      label: 'Contacted',
      flex: 1,
      minWidth: 100,
      render: (campaign) => (
        <Text className="text-sm text-gray-300">
          {campaign.contactedEnrollmentCount.toLocaleString()}
        </Text>
      ),
    },
  ];
}
