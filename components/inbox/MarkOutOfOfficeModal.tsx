import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { addYears, format } from 'date-fns';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import { DateInput } from '@/components/ui/DateInput';
import { Toggle } from '@/components/ui/Toggle';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/feedback';
import { computeOooResumeAtIso, utcNoonIsoFromYmd, type OooScheduleMode } from '@/lib/inbox/outOfOfficeSchedule';
import { markEmailThreadOutOfOffice } from '@/lib/supabase/services/inbox/out-of-office';
import { supabase } from '@/lib/supabase/client';

export type { OooScheduleMode };

export interface MarkOutOfOfficeModalProps {
  visible: boolean;
  onClose: () => void;
  threadId: string;
  enrollmentId: string | null;
  /** yyyy-mm-dd from parser, optional */
  prefilledReturnDateYmd: string | null;
  isCurrentlyOutOfOffice: boolean;
  onSaved: () => void;
}

export function MarkOutOfOfficeModal({
  visible,
  onClose,
  threadId,
  enrollmentId,
  prefilledReturnDateYmd,
  isCurrentlyOutOfOffice,
  onSaved,
}: MarkOutOfOfficeModalProps) {
  const { toast } = useToast();
  const [resumeCampaign, setResumeCampaign] = useState(true);
  const [mode, setMode] = useState<OooScheduleMode>('return_date');
  const [returnDateYmd, setReturnDateYmd] = useState('');
  const [saving, setSaving] = useState(false);

  // Resume scheduling only applies to enrollments stopped by a reply
  // (apply_ooo_resume_core is a no-op otherwise). Categorizer flows never
  // stop on reply - there, setting the thread category to "Auto Reply" is
  // the equivalent action - so hide the option instead of saving a no-op.
  const [resumeEligible, setResumeEligible] = useState<boolean | null>(null);

  useEffect(() => {
    if (!visible) return;
    setResumeCampaign(true);
    setMode('return_date');
    setReturnDateYmd(prefilledReturnDateYmd ?? '');

    if (!enrollmentId) {
      setResumeEligible(false);
      return;
    }
    setResumeEligible(null);
    let cancelled = false;
    void supabase
      .from('enrollments')
      .select('state, stopped_reason')
      .eq('id', enrollmentId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          // Can't verify - keep prior behavior (RPC no-ops if ineligible).
          setResumeEligible(true);
          return;
        }
        setResumeEligible(data.state === 'stopped' && data.stopped_reason === 'replied');
      });
    return () => {
      cancelled = true;
    };
  }, [visible, prefilledReturnDateYmd, enrollmentId]);

  const canResume = enrollmentId != null && resumeEligible === true;

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
    if (!resumeCampaign || !canResume) return null;
    if (mode === 'return_date') {
      if (!returnDateYmd.trim()) return 'Pick a return date.';
      if (!utcNoonIsoFromYmd(returnDateYmd.trim())) return 'Pick a valid return date.';
    }
    return null;
  }, [resumeCampaign, canResume, mode, returnDateYmd]);

  const handleSave = async () => {
    if (validationError) {
      toast.error(validationError);
      return;
    }
    const resumeRequested = resumeCampaign && canResume;
    const resumeAt = computeResumeAtIso();
    if (resumeRequested && !resumeAt) {
      toast.error('Could not compute resume time.');
      return;
    }
    setSaving(true);
    try {
      await markEmailThreadOutOfOffice({
        threadId,
        outOfOffice: true,
        resumeRequested,
        resumeAt: resumeRequested ? resumeAt : null,
      });
      toast.success('Out of office saved');
      onSaved();
      onClose();
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
      toast.success('Out of office cleared');
      onSaved();
      onClose();
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
      maxHeight={520}
    >
      <View className="gap-4">
        {canResume ? (
          <View className="flex-row items-center justify-between gap-3 py-0.5">
            <Text className="text-sm font-instrument text-gray-300 flex-1 shrink">
              Resume campaign after return
            </Text>
            <View className="shrink-0" style={{ paddingVertical: 2 }}>
              <Toggle value={resumeCampaign} onValueChange={setResumeCampaign} />
            </View>
          </View>
        ) : null}

        {resumeCampaign && canResume ? (
          <>
            <View className="flex-row gap-2">
              {(['return_date', 'instant'] as const).map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  className="flex-1 py-2 px-3 rounded-lg border"
                  style={{
                    borderColor: mode === m ? '#F97316' : '#3A3A3A',
                    backgroundColor: mode === m ? 'rgba(249, 115, 22, 0.12)' : 'transparent',
                  }}
                >
                  <Text
                    className="text-center text-xs font-instrument-medium"
                    style={{ color: mode === m ? '#FDBA74' : '#9CA3AF' }}
                  >
                    {m === 'return_date' ? 'Return date' : 'Instant'}
                  </Text>
                </Pressable>
              ))}
            </View>

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
                  disabled={!canResume}
                  placeholder="Pick return date"
                />
              </View>
            ) : (
              <Text className="text-xs font-instrument text-gray-400 leading-5">
                The campaign will resume as soon as you save (if the enrollment can be reactivated).
              </Text>
            )}
          </>
        ) : null}

        <View className="flex-row gap-2 flex-wrap">
          <Button variant="default" className="flex-1 min-w-[120px]" onPress={() => void handleSave()} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-instrument-medium">Save</Text>}
          </Button>
          <Button variant="secondary" className="flex-1 min-w-[120px]" onPress={onClose} disabled={saving}>
            <Text className="text-gray-200 font-instrument-medium">Cancel</Text>
          </Button>
        </View>

        {isCurrentlyOutOfOffice ? (
          <Pressable onPress={() => void handleClear()} disabled={saving} className="py-2">
            <Text className="text-center text-sm font-instrument text-amber-400">Clear out of office</Text>
          </Pressable>
        ) : null}
      </View>
    </BaseModal>
  );
}
