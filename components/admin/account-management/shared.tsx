import React from 'react';
import { Text, View } from 'react-native';
import { authLabelClassName } from '@/components/auth/authFormStyles';
import type { PlatformInvitationLifecycleStatus } from '@/lib/supabase/services/platform';
import {
  getProposalPlanPreset,
  isProposalPlanTier,
  type ProposalPlanTier,
} from '@/lib/platform-invite/proposalPlans';

export interface ProposalSnapshot {
  proposal_title: string;
  client_logo_url: string;
  client_logo_scale: number;
  client_logo_offset_x: number;
  plan_tier: ProposalPlanTier;
  website_traffic_sourcing_enabled: boolean;
  reply_handling_enabled: boolean;
  managed_outreach_volume: number | null;
  managed_inbox_count: number | null;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeOptionalPositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

export function normalizeProposalSnapshot(value: unknown): ProposalSnapshot {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const planTier = isProposalPlanTier(source.plan_tier) ? source.plan_tier : 'silver';
  const preset = getProposalPlanPreset(planTier);

  return {
    proposal_title:
      typeof source.proposal_title === 'string' && source.proposal_title.trim()
        ? source.proposal_title.trim()
        : preset.proposalTitle,
    client_logo_url: typeof source.client_logo_url === 'string' ? source.client_logo_url.trim() : '',
    client_logo_scale: normalizeNumber(source.client_logo_scale, 1, 0.5, 1.5),
    client_logo_offset_x: normalizeNumber(source.client_logo_offset_x, 0, -80, 80),
    plan_tier: planTier,
    website_traffic_sourcing_enabled: Boolean(source.website_traffic_sourcing_enabled),
    reply_handling_enabled: Boolean(source.reply_handling_enabled),
    managed_outreach_volume: normalizeOptionalPositiveInteger(source.managed_outreach_volume),
    managed_inbox_count: normalizeOptionalPositiveInteger(source.managed_inbox_count),
  };
}

export function formatUsd(cents?: number | null) {
  if (typeof cents !== 'number' || Number.isNaN(cents)) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function AdminField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mb-4">
      <Text className={authLabelClassName}>{label}</Text>
      {children}
    </View>
  );
}

function getStatusBadgeTone(status: string) {
  switch (status) {
    case 'active':
      return {
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/25',
        text: 'text-emerald-300',
      };
    case 'sent':
    case 'pending':
    case 'pending_payment':
      return {
        bg: 'bg-blue-500/10',
        border: 'border-blue-500/25',
        text: 'text-blue-300',
      };
    case 'approved':
      return {
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/25',
        text: 'text-amber-300',
      };
    case 'revoked':
      return {
        bg: 'bg-red-500/10',
        border: 'border-red-500/25',
        text: 'text-red-300',
      };
    case 'draft':
    case 'expired':
      return {
        bg: 'bg-[#1F1F1F]',
        border: 'border-[#2A2A2A]',
        text: 'text-gray-300',
      };
    default:
      return {
        bg: 'bg-[#1F1F1F]',
        border: 'border-[#2A2A2A]',
        text: 'text-gray-300',
      };
  }
}

function formatStatusLabel(status: string) {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function StatusBadge({
  status,
  label,
}: {
  status: PlatformInvitationLifecycleStatus | 'active' | string;
  label?: string;
}) {
  const tone = getStatusBadgeTone(status);
  return (
    <View className={`self-start rounded-full border px-2.5 py-1 ${tone.bg} ${tone.border}`}>
      <Text className={`text-xs font-instrument-medium ${tone.text}`}>
        {label ?? formatStatusLabel(status)}
      </Text>
    </View>
  );
}
