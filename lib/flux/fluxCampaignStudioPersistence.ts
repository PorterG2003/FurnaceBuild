import AsyncStorage from '@react-native-async-storage/async-storage';

const STUDIO_UNLOCKED_PREFIX = 'fluxCampaignStudioUnlocked:';

function studioUnlockedKey(campaignId: string) {
  return `${STUDIO_UNLOCKED_PREFIX}${campaignId}`;
}

export async function getFluxCampaignStudioUnlocked(campaignId: string): Promise<boolean> {
  const raw = await AsyncStorage.getItem(studioUnlockedKey(campaignId));
  return raw === '1';
}

export async function setFluxCampaignStudioUnlocked(campaignId: string, value: boolean): Promise<void> {
  if (value) {
    await AsyncStorage.setItem(studioUnlockedKey(campaignId), '1');
    return;
  }
  await AsyncStorage.removeItem(studioUnlockedKey(campaignId));
}
