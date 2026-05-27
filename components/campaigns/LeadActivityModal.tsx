import { useState, useEffect } from 'react';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import type { LeadReplacementSummary } from '@/lib/supabase/services/leads';
import { loadLeadActivityForMembership } from '@/lib/leads/activity/loadLeadActivity';
import { LeadActivityTimeline } from '@/components/leads/detail/LeadActivityTimeline';

interface LeadActivityModalProps {
  visible: boolean;
  onClose: () => void;
  leadId: string;
  campaignId: string;
  leadEmail: string;
  leadName: string | null;
  replacementSummary?: LeadReplacementSummary | null;
}

export function LeadActivityModal({
  visible,
  onClose,
  leadId,
  campaignId,
  leadEmail,
  leadName,
  replacementSummary = null,
}: LeadActivityModalProps) {
  const [loading, setLoading] = useState(true);
  const [activities, setActivities] = useState<Awaited<ReturnType<typeof loadLeadActivityForMembership>>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !leadId || !campaignId) {
      return;
    }

    let cancelled = false;

    const loadActivity = async () => {
      try {
        setLoading(true);
        setError(null);
        const items = await loadLeadActivityForMembership(leadId, campaignId, replacementSummary);
        if (!cancelled) {
          setActivities(items);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadActivity();
    return () => {
      cancelled = true;
    };
  }, [visible, leadId, campaignId, replacementSummary]);

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={`Activity: ${leadName || leadEmail}`}
      description={leadEmail}
      maxWidth="2xl"
    >
      <LeadActivityTimeline
        activities={activities}
        loading={loading}
        error={error}
        replacementSummary={replacementSummary}
        maxHeight={600}
      />
    </BaseModal>
  );
}
