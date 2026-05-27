import { useCallback, useState } from 'react';
import {
  pauseCampaignAndDeferJobs,
  resumeCampaignAndRescheduleJobs,
  stopCampaignAndStopEnrollments,
} from '@/lib/supabase/services/campaigns';

export function useCampaignStatusActions(
  campaignId: string | undefined,
  reload: (silent?: boolean) => void | Promise<void>
) {
  const [isPausing, setIsPausing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  const handlePause = useCallback(async () => {
    if (!campaignId) return;
    setIsPausing(true);
    try {
      await pauseCampaignAndDeferJobs(campaignId);
      await reload(true);
    } catch (err) {
      console.error('Error pausing campaign:', err);
    } finally {
      setIsPausing(false);
    }
  }, [campaignId, reload]);

  const handleResume = useCallback(async () => {
    if (!campaignId) return;
    setIsStarting(true);
    try {
      await resumeCampaignAndRescheduleJobs(campaignId);
      await reload(true);
    } catch (err) {
      console.error('Error resuming campaign:', err);
    } finally {
      setIsStarting(false);
    }
  }, [campaignId, reload]);

  const handleStop = useCallback(async () => {
    if (!campaignId) return;
    setIsStopping(true);
    try {
      await stopCampaignAndStopEnrollments(campaignId);
      await reload(true);
    } catch (err) {
      console.error('Error stopping campaign:', err);
    } finally {
      setIsStopping(false);
    }
  }, [campaignId, reload]);

  return {
    isPausing,
    isStarting,
    isStopping,
    handlePause,
    handleResume,
    handleStop,
  };
}
