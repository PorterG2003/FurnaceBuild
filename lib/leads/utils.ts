import type { Lead } from '@/lib/supabase/types';
import { reportErrorToSlack } from '@/lib/slack/reportErrorToSlack';

/**
 * Display name for a lead: name, or first + last, or email.
 * Pure presentation helper; not a database operation.
 */
export function getLeadDisplayName(lead: Lead | null): string {
  if (!lead) return '';
  if (lead.name && lead.name.trim()) return lead.name.trim();
  const firstLast = [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim();
  if (firstLast) return firstLast;
  if (lead.email && lead.email.trim()) return lead.email.trim();
  return '';
}

/**
 * Generate global lead ID from email (SHA-256 hash).
 * Matches the database function generate_global_lead_id.
 * Uses Web Crypto when available; returns null in Node or on failure.
 */
export async function generateGlobalLeadId(email: string | null | undefined): Promise<string | null> {
  if (!email) return null;

  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(email.toLowerCase().trim());
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      return hashHex;
    } catch (error) {
      console.error('Failed to generate global lead ID:', error);
      const msg = error instanceof Error ? error.message : String(error);
      reportErrorToSlack('Failed to generate global lead ID', { severity: 'warning', error: msg });
      return null;
    }
  }
  return null;
}
