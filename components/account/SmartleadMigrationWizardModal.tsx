import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { CheckIcon, MagnifyingGlassIcon, XMarkIcon } from 'react-native-heroicons/outline';
import { BaseModal } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import { useAccount } from '@/contexts/AccountContext';
import {
  fetchSmartleadCampaigns,
  migrateSmartleadCampaigns,
  type CampaignMigrationResult,
  type MigrationProgress,
  type SmartleadCampaign,
} from '@/lib/smartlead/migration';

const STEPS = ['API Key', 'Campaigns', 'Migrate'] as const;

type CampaignRow = { campaign: SmartleadCampaign; depth: number };

const STATUS_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  ACTIVE: { bg: 'bg-green-500/15', border: 'border-green-500/30', text: 'text-green-400' },
  COMPLETED: { bg: 'bg-blue-500/15', border: 'border-blue-500/30', text: 'text-blue-400' },
  STOPPED: { bg: 'bg-red-500/15', border: 'border-red-500/30', text: 'text-red-400' },
  PAUSED: { bg: 'bg-orange-500/15', border: 'border-orange-500/30', text: 'text-orange-400' },
  DRAFTED: { bg: 'bg-gray-500/15', border: 'border-gray-500/25', text: 'text-gray-400' },
};
const DEFAULT_STATUS_STYLE = { bg: 'bg-gray-500/15', border: 'border-gray-500/25', text: 'text-gray-400' };

const campaignSelectionColumns: TableColumn<CampaignRow>[] = [
  {
    key: 'campaign',
    label: 'Campaign',
    flex: 1,
    minWidth: 180,
    render: (row) => (
      <View className="flex-row items-center">
        {row.depth === 1 && (
          <Text className="text-gray-600 text-sm mr-1.5">↳</Text>
        )}
        <Text
          className={`text-sm ${row.depth === 1 ? 'text-gray-300 font-instrument' : 'text-white font-instrument-medium'}`}
          numberOfLines={1}
        >
          {row.campaign.name || `Campaign #${row.campaign.id}`}
        </Text>
      </View>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    minWidth: 160,
    maxWidth: 160,
    render: (row) => {
      if (!row.campaign.status) return null;
      const s = STATUS_STYLES[row.campaign.status.toUpperCase()] ?? DEFAULT_STATUS_STYLE;
      return (
        <View className={`self-start px-2 py-0.5 rounded ${s.bg} border ${s.border}`}>
          <Text className={`text-xs font-instrument-medium capitalize ${s.text}`}>
            {row.campaign.status.toLowerCase()}
          </Text>
        </View>
      );
    },
  },
];

function MigrationCheckCell({ value }: { value: boolean }) {
  return (
    <View className="flex-1 items-center justify-center">
      {value ? (
        <View className="h-5 w-5 items-center justify-center rounded-full bg-green-500/20">
          <CheckIcon size={12} color="#22c55e" />
        </View>
      ) : (
        <View className="h-5 w-5 items-center justify-center rounded-full bg-neutral-700/60">
          <XMarkIcon size={12} color="#6B7280" />
        </View>
      )}
    </View>
  );
}

const migrationResultColumns: TableColumn<CampaignMigrationResult>[] = [
  {
    key: 'campaign',
    label: 'Campaign',
    flex: 2,
    minWidth: 140,
    render: (r) => (
      <Text
        className={`text-sm font-instrument-medium ${r.status === 'succeeded' ? 'text-white' : 'text-red-300'}`}
        numberOfLines={1}
      >
        {r.campaignName}
      </Text>
    ),
  },
  {
    key: 'leads',
    label: 'Leads',
    minWidth: 72,
    maxWidth: 72,
    render: (r) => (
      <Text className="text-neutral-300 text-xs font-instrument text-center w-full">
        {r.status === 'succeeded' ? String(r.leadsImported ?? 0) : '—'}
      </Text>
    ),
  },
  {
    key: 'totals',
    label: 'Totals',
    minWidth: 72,
    maxWidth: 72,
    render: (r) => (
      <MigrationCheckCell value={r.status === 'succeeded' ? (r.totalsStatsImported ?? false) : false} />
    ),
  },
  {
    key: 'daily',
    label: 'Daily',
    minWidth: 72,
    maxWidth: 72,
    render: (r) => (
      <MigrationCheckCell value={r.status === 'succeeded' ? (r.dayByDayStatsImported ?? false) : false} />
    ),
  },
  {
    key: 'notes',
    label: 'Error',
    flex: 3,
    minWidth: 120,
    render: (r) => (
      <Text
        className={`text-xs font-instrument ${r.status === 'failed' ? 'text-red-400/80' : 'text-neutral-600'}`}
        numberOfLines={2}
      >
        {r.status === 'failed' ? (r.error ?? '') : ''}
      </Text>
    ),
  },
];

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function SmartleadMigrationWizardModal({ visible, onClose }: Props) {
  const { height: windowHeight } = useWindowDimensions();
  const { user, account } = useAccount();

  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [campaigns, setCampaigns] = useState<SmartleadCampaign[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [campaignSearchQuery, setCampaignSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [migrating, setMigrating] = useState(false);
  const [progress, setProgress] = useState<MigrationProgress | null>(null);

  const campaignRows = useMemo((): CampaignRow[] => {
    if (campaigns.length === 0) return [];
    const campaignIds = new Set(campaigns.map((c) => c.id));
    const roots = campaigns.filter((c) => c.parent_campaign_id == null);
    const childrenByParent = new Map<number, SmartleadCampaign[]>();
    for (const c of campaigns) {
      if (c.parent_campaign_id != null && campaignIds.has(c.parent_campaign_id)) {
        const list = childrenByParent.get(c.parent_campaign_id) ?? [];
        list.push(c);
        childrenByParent.set(c.parent_campaign_id, list);
      }
    }
    const ordered: CampaignRow[] = [];
    for (const root of roots) {
      ordered.push({ campaign: root, depth: 0 });
      for (const child of childrenByParent.get(root.id) ?? []) {
        ordered.push({ campaign: child, depth: 1 });
      }
    }
    const orphans = campaigns.filter(
      (c) => c.parent_campaign_id != null && !campaignIds.has(c.parent_campaign_id!)
    );
    for (const o of orphans) {
      ordered.push({ campaign: o, depth: 0 });
    }
    return ordered;
  }, [campaigns]);

  const campaignSelectedKeys = useMemo(
    () => new Set([...selectedIds].map(String)),
    [selectedIds]
  );

  const filteredCampaignRows = useMemo(() => {
    if (!campaignSearchQuery.trim()) return campaignRows;
    const q = campaignSearchQuery.trim().toLowerCase();
    return campaignRows.filter((row) => {
      const name = (row.campaign.name || `Campaign #${row.campaign.id}`).toLowerCase();
      const status = (row.campaign.status ?? '').toLowerCase();
      return name.includes(q) || status.includes(q);
    });
  }, [campaignRows, campaignSearchQuery]);

  const [result, setResult] = useState<{
    succeeded: string[];
    failed: { name: string; error: string }[];
    statsImported?: boolean;
    totalLeadsImported?: number;
    campaignResults?: CampaignMigrationResult[];
  } | null>(null);

  useEffect(() => {
    if (!visible) {
      setStep(0);
      setApiKey('');
      setCampaigns([]);
      setSelectedIds(new Set());
      setCampaignSearchQuery('');
      setLoading(false);
      setError(null);
      setMigrating(false);
      setProgress(null);
      setResult(null);
    }
  }, [visible]);

  const handleFetchCampaigns = useCallback(async () => {
    setStep(1);
    setLoading(true);
    setError(null);
    setCampaigns([]);
    setSelectedIds(new Set());
    try {
      const list = await fetchSmartleadCampaigns(apiKey.trim());
      setCampaigns(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to fetch campaigns.');
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  const handleBack = useCallback(() => {
    if (step === 1) {
      setStep(0);
      setCampaigns([]);
      setSelectedIds(new Set());
      setError(null);
    }
  }, [step]);

  const toggleCampaign = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === campaigns.length) return new Set();
      return new Set(campaigns.map((c) => c.id));
    });
  }, [campaigns]);

  const handleMigrate = useCallback(async () => {
    if (!account || !user) return;
    const selected = campaigns.filter((c) => selectedIds.has(c.id));
    if (selected.length === 0) return;

    setStep(2);
    setMigrating(true);
    setResult(null);
    setError(null);

    try {
      const res = await migrateSmartleadCampaigns(
        apiKey.trim(),
        selected,
        account.id,
        user.id,
        (p) => setProgress(p),
      );
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Migration failed.');
    } finally {
      setMigrating(false);
    }
  }, [apiKey, campaigns, selectedIds, account, user]);

  const canNext = step === 0 && apiKey.trim().length > 0;
  const canMigrate = step === 1 && selectedIds.size > 0 && !loading;

  const footer = (
    <View className="flex-row items-center justify-between">
      <View>
        {step === 1 && !migrating && (
          <TouchableOpacity
            onPress={handleBack}
            disabled={loading}
            style={{
              borderRadius: 12,
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderWidth: 1,
              borderColor: loading ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.18)',
              opacity: loading ? 0.5 : 1,
            }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 14, fontFamily: 'Instrument Sans, system-ui, sans-serif' }}>
              Back
            </Text>
          </TouchableOpacity>
        )}
      </View>
      <View>
        {step === 0 && (
          <Button onPress={handleFetchCampaigns} disabled={!canNext}>
            Next
          </Button>
        )}
        {step === 1 && (
          <Button onPress={handleMigrate} disabled={!canMigrate}>
            Migrate Selected ({selectedIds.size})
          </Button>
        )}
        {step === 2 && !migrating && (
          <Button onPress={onClose} variant="secondary">
            Close
          </Button>
        )}
      </View>
    </View>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Smartlead Migration"
      description="Import your campaigns and leads from Smartlead"
      footer={footer}
      maxWidth="4xl"
      maxHeight={Math.round(windowHeight * 0.75)}
    >
      <View className="gap-6" style={{ flex: 1 }}>
        {/* Step indicator */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          {STEPS.map((label, index) => {
            const isActive = index === step;
            const isComplete = index < step;
            return (
              <View key={label} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ alignItems: 'center', minWidth: 88 }}>
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: isActive
                        ? '#F3440D'
                        : isComplete
                          ? 'rgba(243,68,13,0.4)'
                          : 'rgba(255,255,255,0.08)',
                    }}
                  >
                    <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '600' }}>
                      {index + 1}
                    </Text>
                  </View>
                  <Text
                    style={{
                      marginTop: 6,
                      color: isActive ? '#FFFFFF' : '#9CA3AF',
                      fontSize: 11,
                      fontFamily: 'Instrument Sans, system-ui, sans-serif',
                      fontWeight: isActive ? '600' : '500',
                      letterSpacing: 1,
                      textTransform: 'uppercase',
                      textAlign: 'center',
                    }}
                  >
                    {label}
                  </Text>
                </View>
                {index < STEPS.length - 1 && (
                  <View
                    style={{
                      width: 40,
                      height: 1,
                      backgroundColor: 'rgba(255,255,255,0.1)',
                      marginHorizontal: 8,
                    }}
                  />
                )}
              </View>
            );
          })}
        </View>

        {/* Step 0: API Key */}
        {step === 0 && (
          <View className="gap-4">
            <View>
              <Text className="text-xs text-gray-400 font-instrument-medium mb-2">
                Smartlead API Key
              </Text>
              <TextInput
                value={apiKey}
                onChangeText={setApiKey}
                placeholder="Enter your Smartlead API key"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                autoCorrect={false}
                className="border rounded-lg px-3 py-2.5 bg-[#121212] text-sm text-white"
                style={{
                  borderColor: '#3A3A3A',
                  backgroundColor: '#121212',
                  color: '#FFFFFF',
                  borderWidth: 1,
                }}
              />
              <Text className="text-xs text-gray-500 mt-2">
                Find your API key in Smartlead under Settings. Your key is only used for this session and is not stored.
              </Text>
              <View className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <Text className="text-amber-200 text-sm font-instrument">
                  Anything you import here will be added to the account you are currently viewing. If you manage multiple accounts, make sure you only import the campaigns that belong to that account so they are assigned correctly.
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Step 1: Campaign list with selection */}
        {step === 1 && (
          <View style={{ flex: 1 }}>
            {loading && (
              <View className="items-center justify-center py-12">
                <ActivityIndicator size="large" color="#F3440D" />
                <Text className="text-gray-400 font-instrument mt-4">
                  Loading campaigns from Smartlead...
                </Text>
              </View>
            )}

            {error && !loading && (
              <View className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                <Text className="text-red-400 text-sm font-instrument">{error}</Text>
              </View>
            )}

            {!loading && !error && campaigns.length === 0 && (
              <View className="items-center py-12">
                <Text className="text-gray-400 text-sm font-instrument">
                  No campaigns found in your Smartlead account.
                </Text>
              </View>
            )}

            {!loading && !error && campaigns.length > 0 && (
              <View style={{ flex: 1 }}>
                <View className="flex-row items-center justify-between mb-2">
                  <Text className="text-xs text-gray-400 font-instrument-medium">
                    Campaigns ({campaigns.length}) — sub-campaigns nested under parents
                  </Text>
                  <TouchableOpacity onPress={toggleAll} activeOpacity={0.7}>
                    <Text className="text-xs text-brand-orange font-instrument-medium">
                      {selectedIds.size === campaigns.length ? 'Deselect All' : 'Select All'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <View className="flex-row items-center rounded-lg border border-[#2A2A2A] bg-[#121212] px-3 py-2 mb-3">
                  <MagnifyingGlassIcon size={18} color="#9CA3AF" style={{ marginRight: 8 }} />
                  <TextInput
                    value={campaignSearchQuery}
                    onChangeText={setCampaignSearchQuery}
                    placeholder="Search campaigns by name or status..."
                    placeholderTextColor="#9CA3AF"
                    className="flex-1 text-sm text-white font-instrument"
                    style={{ paddingVertical: 4 }}
                  />
                </View>
                <View style={{ flex: 1, minHeight: 280 }}>
                  <DataTable<CampaignRow>
                    items={filteredCampaignRows}
                    getItemKey={(row) => String(row.campaign.id)}
                    columns={campaignSelectionColumns}
                    selectable
                    selectedKeys={campaignSelectedKeys}
                    onSelectionChange={(keys) => setSelectedIds(new Set(Array.from(keys).map(Number)))}
                    pagination
                    itemsPerPage={25}
                    compactHeader
                    emptyMessage={
                      campaignSearchQuery.trim()
                        ? 'No campaigns match your search'
                        : 'No campaigns'
                    }
                  />
                </View>
              </View>
            )}
          </View>
        )}

        {/* Step 2: Migration progress / results */}
        {step === 2 && (
          <View className="gap-4">
            {migrating && progress && (
              <View className="items-center justify-center py-12 gap-4">
                <ActivityIndicator size="large" color="#F3440D" />
                <Text className="text-white text-sm font-instrument-medium">
                  Migrating campaign {progress.campaignIndex + 1} of {progress.campaignCount}
                </Text>
                <Text className="text-gray-400 text-xs font-instrument">
                  {progress.campaignName}
                  {progress.phase === 'campaign' && ' — creating campaign...'}
                  {progress.phase === 'leads' && ' — fetching & importing leads...'}
                  {progress.phase === 'enrollments' && ` — creating enrollments (${progress.leadCount ?? 0} leads)...`}
                  {progress.phase === 'stats' && ' — importing stats...'}
                </Text>
              </View>
            )}

            {!migrating && error && (
              <View className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                <Text className="text-red-400 text-sm font-instrument">{error}</Text>
              </View>
            )}

            {!migrating && result && (result.campaignResults?.length ?? 0) > 0 && (
              <View className="rounded-xl overflow-hidden">
                <DataTable<CampaignMigrationResult>
                  items={result.campaignResults ?? []}
                  getItemKey={(r) =>
                    `${r.campaignName}-${r.status}-${r.error ?? ''}-${r.leadsImported ?? 0}-${r.totalsStatsImported}-${r.dayByDayStatsImported}`
                  }
                  pagination={false}
                  compactHeader
                  emptyMessage="No results"
                  columns={migrationResultColumns}
                />
              </View>
            )}
          </View>
        )}
      </View>
    </BaseModal>
  );
}
