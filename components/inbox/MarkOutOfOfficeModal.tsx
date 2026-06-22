import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { addYears, format } from 'date-fns';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { DateInput } from '@/components/ui/DateInput';
import { Toggle } from '@/components/ui/Toggle';
import { Button } from '@/components/ui/button';
import { Tabs, type Tab } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/feedback';
import { useInboxInteractionSession } from '@/contexts/InboxInteractionContext';
import { buildInteractionIntent } from '@/lib/inbox/buildInteractionIntent';
import { computeOooResumeAtIso, utcNoonIsoFromYmd, type OooScheduleMode } from '@/lib/inbox/outOfOfficeSchedule';
import { parseSmartHandlingMetadata } from '@/lib/inbox/smartHandling';
import { markEmailThreadOutOfOffice, saveEmailThreadOutOfOffice } from '@/lib/supabase/services/inbox/out-of-office';

export type { OooScheduleMode };

const OOO_SCHEDULE_TABS: Tab[] = [
  { id: 'return_date', label: 'Return date' },
  { id: 'instant', label: 'Instant' },
];

export interface MarkOutOfOfficeModalProps {
  visible: boolean;
  onClose: () => void;
  threadId: string;
  /** yyyy-mm-dd from parser, optional */
  prefilledReturnDateYmd: string | null;
  isCurrentlyOutOfOffice: boolean;
  markAutoReplyOnSave?: boolean;
  onSaved: () => Promise<void> | void;
}

function resolveOooModalAction(params: {
  mode: OooScheduleMode;
  resumeCampaign: boolean;
  returnDateYmd: string;
  prefilledReturnDateYmd: string | null;
}): 'thread.mark_ooo_dated' | 'thread.mark_ooo_instant' | 'thread.mark_ooo_custom' {
  if (!params.resumeCampaign) {
    return 'thread.mark_ooo_custom';
  }
  if (params.mode === 'instant') {
    return 'thread.mark_ooo_instant';
  }
  return params.prefilledReturnDateYmd?.trim() && params.returnDateYmd.trim() === params.prefilledReturnDateYmd.trim()
    ? 'thread.mark_ooo_dated'
    : 'thread.mark_ooo_custom';
}

export function MarkOutOfOfficeModal({
  visible,
  onClose,
  threadId,
  prefilledReturnDateYmd,
  isCurrentlyOutOfOffice,
  markAutoReplyOnSave = false,
  onSaved,
}: MarkOutOfOfficeModalProps) {
  const { toast } = useToast();
  const interactionSession = useInboxInteractionSession();
  const [resumeCampaign, setResumeCampaign] = useState(true);
  const [mode, setMode] = useState<OooScheduleMode>('return_date');
  const [returnDateYmd, setReturnDateYmd] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setResumeCampaign(true);
    setMode('return_date');
    setReturnDateYmd(prefilledReturnDateYmd ?? '');
  }, [visible, prefilledReturnDateYmd]);

  const { minReturnYmd, maxReturnYmd } = useMemo(() => {
    const today = new Date();
    return {
      minReturnYmd: format(today, 'yyyy-MM-dd'),
      maxReturnYmd: format(addYears(today, 5), 'yyyy-MM-dd'),
    };
  }, []);

  const computeResumeAtIso = useCallback((): string | null => {
    return computeOooResumeAtIso({
      resumeCampaign,
      mode,
      returnDateYmd,
    });
  }, [resumeCampaign, mode, returnDateYmd]);

  const validationError = useMemo(() => {
    if (!resumeCampaign) return null;
    if (mode === 'return_date') {
      if (!returnDateYmd.trim()) return 'Pick a return date.';
      if (!utcNoonIsoFromYmd(returnDateYmd.trim())) return 'Pick a valid return date.';
    }
    return null;
  }, [resumeCampaign, mode, returnDateYmd]);

  const handleSave = async () => {
    if (validationError) {
      toast.error(validationError);
      return;
    }
    const resumeRequested = resumeCampaign;
    const resumeAt = computeResumeAtIso();
    if (resumeRequested && !resumeAt) {
      toast.error('Could not compute resume time.');
      return;
    }
    setSaving(true);
    try {
      const action = resolveOooModalAction({
        mode,
        resumeCampaign,
        returnDateYmd,
        prefilledReturnDateYmd,
      });
      const metadata = parseSmartHandlingMetadata(
        (interactionSession.getInteractionSnapshot()?.context.thread.handling_metadata ?? null) as any,
      );
      try {
        await interactionSession.recordInteraction({
          action,
          source: 'ooo_modal',
          intent: buildInteractionIntent({
            metadata,
            actionId:
              action === 'thread.mark_ooo_dated'
                ? 'mark_ooo_dated'
                : action === 'thread.mark_ooo_instant'
                  ? 'mark_ooo_instant'
                  : 'mark_ooo_custom',
          }),
          changes: [
            { field: 'out_of_office', from: false, to: true },
            { field: 'ooo_resume_requested', to: resumeRequested },
            { field: 'ooo_resume_at', to: resumeRequested ? resumeAt : null },
            ...(markAutoReplyOnSave ? [{ field: 'category', to: 'Auto Reply' }] : []),
          ],
        });
      } catch (error) {
        console.error('Failed to record OOO modal interaction:', error);
      }
      await saveEmailThreadOutOfOffice({
        threadId,
        outOfOffice: true,
        resumeRequested,
        resumeAt: resumeRequested ? resumeAt : null,
        returnDateYmd: mode === 'return_date' ? returnDateYmd.trim() || null : null,
        markAutoReply: markAutoReplyOnSave,
      });
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await markEmailThreadOutOfOffice({
        threadId,
        outOfOffice: false,
        resumeRequested: false,
        resumeAt: null,
      });
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear');
    } finally {
      setSaving(false);
    }
  };

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Mark as out of office"
      description="Flag this thread and optionally schedule the lead to resume in the campaign after they return (replies currently pause the sequence)."
      maxWidth="md"
      footer={
        <View className="gap-3">
          {isCurrentlyOutOfOffice ? (
            <Pressable onPress={() => void handleClear()} disabled={saving} className="py-1">
              <Text className="text-center text-sm font-instrument text-amber-400">Clear out of office</Text>
            </Pressable>
          ) : null}
          <ModalFooter layout="inline">
            <Button variant="secondary" onPress={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onPress={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </ModalFooter>
        </View>
      }
      footerMobile={
        <View className="gap-3">
          {isCurrentlyOutOfOffice ? (
            <Pressable onPress={() => void handleClear()} disabled={saving} className="py-1">
              <Text className="text-center text-sm font-instrument text-amber-400">Clear out of office</Text>
            </Pressable>
          ) : null}
          <ModalFooter>
            <Button onPress={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </ModalFooter>
        </View>
      }
    >
      <View className="gap-4">
        <View className="flex-row items-center justify-between gap-3 py-0.5">
          <Text className="text-sm font-instrument text-gray-300 flex-1 shrink">
            Resume campaign after return
          </Text>
          <View className="shrink-0" style={{ paddingVertical: 2 }}>
            <Toggle value={resumeCampaign} onValueChange={setResumeCampaign} />
          </View>
        </View>

        {resumeCampaign ? (
          <>
            <Tabs
              tabs={OOO_SCHEDULE_TABS}
              activeTab={mode}
              onTabChange={(tabId) => setMode(tabId as OooScheduleMode)}
              layout="equal"
              marginBottom={0}
            />

            {mode === 'return_date' ? (
              <View>
                <Text className="text-xs font-instrument-medium text-gray-400 mb-1">
                  Return date (UTC calendar day, noon)
                </Text>
                <DateInput
                  value={returnDateYmd}
                  onChange={setReturnDateYmd}
                  min={minReturnYmd}
                  max={maxReturnYmd}
                  placeholder="Pick return date"
                />
              </View>
            ) : (
              <Text className="text-xs font-instrument text-gray-400 leading-5">
                The campaign will resume as soon as you save.
              </Text>
            )}
          </>
        ) : null}
      </View>
    </BaseModal>
  );
}
