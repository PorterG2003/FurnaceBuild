import { supabase } from '../../client';
import { CSV_IMPORT_PREVIEW_EMAIL_CHUNK } from '@/lib/leads/csv-import-constants';

export type CsvImportPreviewResult = {
  matchingEmails: Set<string>;
  countByCampaign: Record<string, number>;
};

function chunk<T>(values: T[], chunkSize: number): T[][] {
  if (values.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  return chunks;
}

export async function previewCsvEmailsInCampaigns(
  accountId: string,
  campaignIds: string[],
  emails: string[],
): Promise<CsvImportPreviewResult> {
  const uniqueCampaignIds = [...new Set(campaignIds.filter(Boolean))];
  const uniqueEmails = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];

  if (uniqueCampaignIds.length === 0 || uniqueEmails.length === 0) {
    return { matchingEmails: new Set(), countByCampaign: {} };
  }

  const matchingEmails = new Set<string>();
  const countByCampaign: Record<string, number> = {};

  for (const emailChunk of chunk(uniqueEmails, CSV_IMPORT_PREVIEW_EMAIL_CHUNK)) {
    const { data, error } = await supabase.rpc('preview_emails_in_campaigns', {
      p_account_id: accountId,
      p_campaign_ids: uniqueCampaignIds,
      p_emails: emailChunk,
    });

    if (error) {
      throw new Error(error.message);
    }

    const row = (data ?? {}) as {
      matchingEmails?: string[];
      countByCampaign?: Record<string, number>;
    };

    for (const email of row.matchingEmails ?? []) {
      if (email) matchingEmails.add(email);
    }

    for (const [campaignId, count] of Object.entries(row.countByCampaign ?? {})) {
      countByCampaign[campaignId] = (countByCampaign[campaignId] ?? 0) + count;
    }
  }

  return { matchingEmails, countByCampaign };
}
