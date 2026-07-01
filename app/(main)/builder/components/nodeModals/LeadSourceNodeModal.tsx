import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Platform, Alert, useWindowDimensions } from 'react-native';
import Papa from 'papaparse';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { EmptyState } from '@/components/ui/feedback';
import { LeadSourceBucketSkeleton } from '@/components/skeletons';
import { WizardStepIndicator } from '@/components/ui/wizard';
import { Button } from '@/components/ui/button';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';
import { CsvImportDedupeStep } from './CsvImportDedupeStep';
import { CsvImportReviewStep, type CsvImportReviewSummary } from './CsvImportReviewStep';
import { CsvImportWizardContentShell } from './CsvImportWizardContentShell';
import { useAccount } from '@/contexts/AccountContext';
import {
  buildCampaignBucketLeadFilters,
  getBucketLeadFieldCoverage,
  getLeadCount,
  getLeads,
} from '@/lib/supabase/services/leads';
import {
  autoMapExistingCustomKeys,
  extractUniqueEmailsFromRows,
  isValidCustomFieldKey,
  mapCsvRowsToLeadPayloads,
  normalizeCustomFieldKey,
  runCsvDedupePipeline,
  type CsvDedupeResult,
} from '@/lib/leads/csv-dedupe';
import { buildLeadSourceFieldConfig } from '@/lib/leads/lead-source-field-config';
import { previewCsvEmailsInCampaigns } from '@/lib/supabase/services/leads/csv-import-preview';
import {
  createCsvLeadImportJob,
  enqueueCsvImportJob,
  finalizeCsvLeadImportJob,
  importCsvLeadsSync,
  pollCsvImportJobUntilDone,
  shouldUseAsyncCsvImport,
  uploadCsvLeadsToStagingJob,
  mapImportJobToCsvResult,
  type CsvImportStats,
} from '@/lib/supabase/services/leads/csv-import-jobs';
import { CampaignPickerModal } from '@/components/campaigns/CampaignPickerModal';
import { getCampaignsListSummary, type CampaignListSummary } from '@/lib/supabase/services/campaigns/campaign-list-summary';
import { useConfirmClose } from '@/hooks/useConfirmClose';
import { usePreventTabClose } from '@/hooks/usePreventTabClose';
import type { Lead } from '@/lib/supabase/types';

interface LeadSourceNodeModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (data: {
    source?: string;
    bucketId?: string;
    customFieldKeys?: string[];
    mappedStandardFieldKeys?: string[];
    keepModalOpen?: boolean;
  }) => void;
  initialData?: {
    source?: string;
    campaignId?: string;
    bucketId?: string;
    customFieldKeys?: string[];
    mappedStandardFieldKeys?: string[];
  };
}

interface ParsedCSV {
  headers: string[];
  normalizedHeaders: string[];
  rows: Record<string, string>[];
}

const INSIGHTS_COLUMN_MIN_WIDTH = 160;
const INSIGHTS_COLUMN_MAX_WIDTH = 240;
const BUCKET_TABLE_PAGE_SIZE = 20;

const STANDARD_BUCKET_FIELD_ORDER = [
  'email',
  'name',
  'first_name',
  'last_name',
  'company_name',
  'phone_number',
  'mobile_phone_number',
  'website',
  'linkedin_url',
  'company_linkedin_url',
  'source',
] as const;

type BucketTableRow = Record<string, string> & { __rowKey: string };

type BucketFieldCoverageMap = Record<string, { filled: number; empty: number }>;

function leadToBucketRecord(lead: Lead): Record<string, string> {
  const record: Record<string, string> = {};

  if (lead.email) record.email = lead.email;
  if (lead.name) record.name = lead.name;
  if (lead.first_name) record.first_name = lead.first_name;
  if (lead.last_name) record.last_name = lead.last_name;
  if (lead.company_name) record.company_name = lead.company_name;
  if (lead.phone_number) record.phone_number = lead.phone_number;
  if (lead.mobile_phone_number) record.mobile_phone_number = lead.mobile_phone_number;
  if (lead.website) record.website = lead.website;
  if (lead.linkedin_url) record.linkedin_url = lead.linkedin_url;
  if (lead.company_linkedin_url) record.company_linkedin_url = lead.company_linkedin_url;
  if (lead.source) record.source = lead.source;

  if (lead.custom_lead_data && typeof lead.custom_lead_data === 'object') {
    Object.entries(lead.custom_lead_data).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        record[key] = String(value);
      }
    });
  }

  return record;
}

function sortBucketFieldKeys(keys: string[]): string[] {
  const remaining = new Set(keys);
  const ordered: string[] = [];

  for (const fieldKey of STANDARD_BUCKET_FIELD_ORDER) {
    if (remaining.has(fieldKey)) {
      ordered.push(fieldKey);
      remaining.delete(fieldKey);
    }
  }

  return [...ordered, ...Array.from(remaining).sort()];
}

const UTF8_BOM = '\ufeff';

/** Robust CSV parser (RFC 4180): quoted fields, commas in quotes, \r\n, BOM. */
function parseCSV(csvText: string): ParsedCSV {
  const trimmed = csvText.trim();
  if (!trimmed.length) {
    return { headers: [], normalizedHeaders: [], rows: [] };
  }
  const withoutBOM = trimmed.startsWith(UTF8_BOM) ? trimmed.slice(UTF8_BOM.length) : trimmed;

  const result = Papa.parse<Record<string, string>>(withoutBOM, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (result.errors.length > 0) {
    const first = result.errors[0];
    const msg = first?.message
      ? `Invalid CSV: ${first.message}`
      : 'Invalid CSV: check that the file has a header row and that commas inside cells are in quoted fields (e.g. "Last, First").';
    throw new Error(msg);
  }

  const fields = result.meta.fields ?? [];
  const headers = fields.length > 0 ? fields : (result.data[0] ? Object.keys(result.data[0]) : []);
  const normalizedHeaders = headers.map((h) => h.toLowerCase());

  const rows: Record<string, string>[] = result.data.map((row) => {
    const out: Record<string, string> = {};
    headers.forEach((header) => {
      const val = row[header];
      out[header] = val != null ? String(val).trim() : '';
    });
    return out;
  });

  return {
    headers,
    normalizedHeaders,
    rows,
  };
}

const csvSteps = ['Upload CSV', 'Map Fields', 'Dedupe', 'Review'] as const;

function buildImportCompleteMessage(stats: CsvImportStats): string {
  const imported = stats.created + stats.updated;
  const base = `Imported ${imported.toLocaleString()} lead${imported === 1 ? '' : 's'}.`;
  if (stats.incomplete > 0) {
    return `${base} ${stats.incomplete.toLocaleString()} ${
      stats.incomplete === 1 ? 'was' : 'were'
    } missing one or more personalization fields.`;
  }
  return base;
}

type CsvImportPhase = 'idle' | 'sync' | 'uploading' | 'importing';

const mappingFields = [
  { id: 'email', label: 'Email Address', required: true },
  { id: 'name', label: 'Full Name', required: false },
  { id: 'first_name', label: 'First Name', required: false },
  { id: 'last_name', label: 'Last Name', required: false },
  { id: 'company_name', label: 'Company Name', required: false },
  { id: 'phone_number', label: 'Company Phone', required: false },
  { id: 'mobile_phone_number', label: 'Mobile Phone', required: false },
  { id: 'website', label: 'Website', required: false },
  { id: 'linkedin_url', label: 'LinkedIn URL', required: false },
  { id: 'company_linkedin_url', label: 'Company LinkedIn URL', required: false },
] as const;

type FieldKey = typeof mappingFields[number]['id'];

const fieldSynonyms: Record<FieldKey, string[]> = {
  email: ['email', 'email address'],
  name: ['name', 'full name', 'first and last name'],
  first_name: ['first name', 'firstname', 'given name', 'first_name'],
  last_name: ['last name', 'lastname', 'surname', 'last_name'],
  company_name: ['company', 'company name', 'organisation', 'organization', 'business'],
  phone_number: ['company phone', 'phone', 'work phone', 'business phone', 'office phone', 'phone number'],
  mobile_phone_number: ['mobile', 'mobile phone', 'cell', 'cell phone', 'personal phone', 'mobile number'],
  website: ['website', 'site', 'url', 'homepage', 'web site'],
  linkedin_url: ['linkedin', 'linkedin url', 'linkedin profile', 'profile url'],
  company_linkedin_url: ['company linkedin', 'company linkedin url', 'linkedin company', 'company profile', 'company profile url'],
};

const createEmptyMappings = (): Record<FieldKey, string> => {
  return mappingFields.reduce((acc, field) => {
    acc[field.id] = '';
    return acc;
  }, {} as Record<FieldKey, string>);
};

const buildAutoMappings = (headers: string[], normalizedHeaders: string[]): Record<FieldKey, string> => {
  const result = createEmptyMappings();

  mappingFields.forEach(field => {
    const synonyms = fieldSynonyms[field.id];
    const matchIndex = normalizedHeaders.findIndex(header => synonyms.includes(header));

    if (matchIndex !== -1) {
      result[field.id] = headers[matchIndex];
    }
  });

  return result;
};

function LeadSourceNodeModal({
  visible,
  onClose,
  onSave,
  initialData,
}: LeadSourceNodeModalProps) {
  const { account, blockList } = useAccount();
  const [isImporting, setIsImporting] = useState(false);
  const [isSavingImport, setIsSavingImport] = useState(false);
  const [importPhase, setImportPhase] = useState<CsvImportPhase>('idle');
  const [importProgress, setImportProgress] = useState({ processed: 0, total: 0, message: '' });
  const [importResult, setImportResult] = useState<CsvImportStats | null>(null);
  const [csvStep, setCsvStep] = useState(0);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [fieldMappings, setFieldMappings] = useState<Record<FieldKey, string>>(() => createEmptyMappings());
  const [customFieldColumns, setCustomFieldColumns] = useState<string[]>([]);
  const [customFieldMappings, setCustomFieldMappings] = useState<Record<string, string>>({});
  const [filterInCampaignsEnabled, setFilterInCampaignsEnabled] = useState(false);
  const [filterBlockListEnabled, setFilterBlockListEnabled] = useState(true);
  const [selectedDedupeCampaignIds, setSelectedDedupeCampaignIds] = useState<string[]>([]);
  const [campaignSummaries, setCampaignSummaries] = useState<CampaignListSummary[]>([]);
  const [showCampaignPicker, setShowCampaignPicker] = useState(false);
  const [dedupeResult, setDedupeResult] = useState<CsvDedupeResult | null>(null);
  const [dedupePreviewLoading, setDedupePreviewLoading] = useState(false);
  const [dedupePreviewError, setDedupePreviewError] = useState<string | null>(null);
  const dedupePreviewRequestRef = useRef(0);
  const [importSummary, setImportSummary] = useState<{
    totalRows: number;
    readyRows: number;
    dedupeRemoved: number;
    dedupeStats: CsvDedupeResult['stats'] | null;
    mappedFields: Record<FieldKey, string>;
    customFields: string[];
    personalizationFields: Array<{ key: string; column: string }>;
    unmappedColumns: string[];
  } | null>(null);
  const [isImportWizardOpen, setIsImportWizardOpen] = useState(false);
  const [tableLeads, setTableLeads] = useState<Lead[]>([]);
  const [leadCount, setLeadCount] = useState<number | null>(null);
  const [fieldCoverage, setFieldCoverage] = useState<BucketFieldCoverageMap>({});
  const [tablePage, setTablePage] = useState(1);
  const [isLoadingBucket, setIsLoadingBucket] = useState(false);
  const [isTableLoading, setIsTableLoading] = useState(false);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isDedupeCompactLayout = windowWidth < LAYOUT_BREAKPOINT;

  const existingCustomKeys = useMemo(
    () => (initialData?.customFieldKeys ?? []).filter((key) => key && key.length > 0),
    [initialData?.customFieldKeys],
  );

  const reviewSummary = useMemo((): CsvImportReviewSummary | null => {
    if (!importSummary) return null;

    const mappedFields: CsvImportReviewSummary['mappedFields'] = [];
    for (const field of mappingFields) {
      const column = importSummary.mappedFields[field.id];
      if (column) {
        mappedFields.push({ label: field.label, column });
      }
    }
    for (const { key, column } of importSummary.personalizationFields) {
      mappedFields.push({ label: `Personalization: ${key}`, column });
    }
    for (const column of importSummary.customFields) {
      mappedFields.push({ label: `Custom: ${column}`, column });
    }

    return {
      totalRows: importSummary.totalRows,
      readyRows: importSummary.readyRows,
      dedupeRemoved: importSummary.dedupeRemoved,
      mappedFields,
      unmappedColumns: importSummary.unmappedColumns,
    };
  }, [importSummary]);

  const displayColumns = useMemo(() => csvColumns.slice(0, 6), [csvColumns]);
  const hiddenColumnCount = csvColumns.length > displayColumns.length ? csvColumns.length - displayColumns.length : 0;

  const normalizedExistingKeySet = useMemo(
    () => new Set(existingCustomKeys.map((key) => normalizeCustomFieldKey(key))),
    [existingCustomKeys],
  );

  const standardMappedColumns = useMemo(
    () => new Set(Object.values(fieldMappings).filter(Boolean)),
    [fieldMappings],
  );

  const personalizationMappedColumns = useMemo(
    () => new Set(Object.values(customFieldMappings).filter(Boolean)),
    [customFieldMappings],
  );

  // Pill selector is reserved for genuinely NEW columns: not used by a standard
  // mapping, not used by a personalization mapping, and not (after normalization)
  // an existing campaign custom key (those collision-merge into the existing key).
  const availableCustomPillColumns = useMemo(
    () =>
      csvColumns.filter((column) => {
        if (standardMappedColumns.has(column)) return false;
        if (personalizationMappedColumns.has(column)) return false;
        if (normalizedExistingKeySet.has(normalizeCustomFieldKey(column))) return false;
        return true;
      }),
    [csvColumns, normalizedExistingKeySet, personalizationMappedColumns, standardMappedColumns],
  );

  // Existing campaign keys that are themselves template-breaking (legacy data).
  const invalidExistingKeys = useMemo(
    () => existingCustomKeys.filter((key) => !isValidCustomFieldKey(key)),
    [existingCustomKeys],
  );

  // New custom columns selected for import whose normalized key is invalid.
  const invalidSelectedCustomColumns = useMemo(
    () => customFieldColumns.filter((column) => !isValidCustomFieldKey(column)),
    [customFieldColumns],
  );

  const mappingErrors = useMemo(() => {
    const errors: string[] = [];
    if (!fieldMappings.email) {
      errors.push('Email must be mapped to import leads.');
    }
    if (invalidSelectedCustomColumns.length > 0) {
      errors.push(
        `These custom field names contain "{" or "}", which breaks personalization tokens: ${invalidSelectedCustomColumns.join(', ')}. Rename the column headers or deselect them.`,
      );
    }
    const mappedInvalidExistingKeys = invalidExistingKeys.filter((key) => customFieldMappings[key]);
    if (mappedInvalidExistingKeys.length > 0) {
      errors.push(
        `These campaign personalization fields contain "{" or "}" and can't be imported: ${mappedInvalidExistingKeys.join(', ')}.`,
      );
    }
    return errors;
  }, [customFieldMappings, fieldMappings, invalidExistingKeys, invalidSelectedCustomColumns]);

  const previewRows = useMemo(() => csvRows.slice(0, 3), [csvRows]);

  const loadBucketSummary = useCallback(async (): Promise<number> => {
    if (!initialData?.campaignId) {
      setLeadCount(0);
      setFieldCoverage({});
      return 0;
    }

    const filters = buildCampaignBucketLeadFilters(
      initialData.campaignId,
      initialData.bucketId,
    );
    const resolvedBucketId = filters.bucketId;

    if (resolvedBucketId) {
      try {
        const coverage = await getBucketLeadFieldCoverage(
          initialData.campaignId,
          resolvedBucketId,
        );
        setLeadCount(coverage.totalCount);

        const coverageMap: BucketFieldCoverageMap = {};
        for (const field of coverage.fields) {
          coverageMap[field.fieldKey] = {
            filled: field.filledCount,
            empty: coverage.totalCount - field.filledCount,
          };
        }
        setFieldCoverage(coverageMap);
        return coverage.totalCount;
      } catch (error) {
        console.warn('Bucket field coverage unavailable; falling back to lead count', error);
      }
    }

    const count = await getLeadCount(filters);
    setLeadCount(count);
    setFieldCoverage({});
    return count;
  }, [initialData?.campaignId, initialData?.bucketId]);

  const loadTablePage = useCallback(
    async (page: number) => {
      if (!initialData?.campaignId) {
        setTableLeads([]);
        setTablePage(1);
        return;
      }

      setIsTableLoading(true);
      try {
        const filters = buildCampaignBucketLeadFilters(
          initialData.campaignId,
          initialData.bucketId,
        );
        const leads = await getLeads({
          ...filters,
          limit: BUCKET_TABLE_PAGE_SIZE,
          offset: (page - 1) * BUCKET_TABLE_PAGE_SIZE,
        });
        setTableLeads(leads);
        setTablePage(page);
      } catch (error) {
        console.error('Failed to fetch bucket leads page:', error);
        setTableLeads([]);
      } finally {
        setIsTableLoading(false);
      }
    },
    [initialData?.campaignId, initialData?.bucketId],
  );

  const loadBucketData = useCallback(async () => {
    setIsLoadingBucket(true);
    try {
      const total = await loadBucketSummary();
      if (total > 0) {
        await loadTablePage(1);
      } else {
        setTableLeads([]);
        setTablePage(1);
      }
    } catch (error) {
      console.error('Failed to load bucket data:', error);
      setLeadCount(0);
      setFieldCoverage({});
      setTableLeads([]);
      setTablePage(1);
    } finally {
      setIsLoadingBucket(false);
    }
  }, [loadBucketSummary, loadTablePage]);

  useEffect(() => {
    if (visible) {
      void loadBucketData();
    }
  }, [visible, initialData?.campaignId, initialData?.bucketId, loadBucketData]);

  const bucketTableRows = useMemo((): BucketTableRow[] => {
    return tableLeads.map((lead) => ({
      ...leadToBucketRecord(lead),
      __rowKey: lead.id,
    }));
  }, [tableLeads]);

  const bucketTableColumnKeys = useMemo(() => {
    const keys = new Set<string>(['email']);
    initialData?.mappedStandardFieldKeys?.forEach((key) => keys.add(key));
    initialData?.customFieldKeys?.forEach((key) => keys.add(key));
    Object.keys(fieldCoverage).forEach((key) => keys.add(key));
    bucketTableRows.forEach((row) => {
      Object.keys(row).forEach((key) => {
        if (key !== '__rowKey') {
          keys.add(key);
        }
      });
    });
    return sortBucketFieldKeys(Array.from(keys));
  }, [
    bucketTableRows,
    fieldCoverage,
    initialData?.customFieldKeys,
    initialData?.mappedStandardFieldKeys,
  ]);

  const bucketTableColumns = useMemo((): TableColumn<BucketTableRow>[] => {
    const total = leadCount ?? 0;

    return bucketTableColumnKeys.map((fieldKey) => {
      const stats = fieldCoverage[fieldKey] ?? { filled: 0, empty: total };
      const minFromLabel = Math.ceil(fieldKey.length * 8);
      const minWidth = Math.min(
        INSIGHTS_COLUMN_MAX_WIDTH,
        Math.max(INSIGHTS_COLUMN_MIN_WIDTH, minFromLabel),
      );

      return {
        key: fieldKey,
        label: fieldKey,
        flex: 0,
        minWidth,
        maxWidth: INSIGHTS_COLUMN_MAX_WIDTH,
        headerStats: { filled: stats.filled, empty: stats.empty },
        render: (item) => (
          <Text className="text-white font-instrument text-sm" numberOfLines={1}>
            {item[fieldKey] ?? '—'}
          </Text>
        ),
      };
    });
  }, [bucketTableColumnKeys, fieldCoverage, leadCount]);

  const handleTablePageChange = useCallback(
    (page: number) => {
      void loadTablePage(page);
    },
    [loadTablePage],
  );

  const isNextDisabled = isSavingImport
    ? true
    : csvStep === 0
      ? csvColumns.length === 0
      : csvStep === 1
        ? mappingErrors.length > 0
        : csvStep === 2
          ? dedupePreviewLoading ||
              (dedupeResult?.stats.kept ?? 0) === 0 ||
              (filterInCampaignsEnabled && selectedDedupeCampaignIds.length === 0)
          : false;

  const preventTabClose = isSavingImport && importPhase !== 'importing';
  usePreventTabClose(preventTabClose);

  const computeDedupePreview = useCallback(async () => {
    const requestId = dedupePreviewRequestRef.current + 1;
    dedupePreviewRequestRef.current = requestId;
    setDedupePreviewLoading(true);
    setDedupePreviewError(null);

    const emailColumn = fieldMappings.email || undefined;
    let matchingCampaignEmails = new Set<string>();

    try {
      if (
        account?.id &&
        filterInCampaignsEnabled &&
        selectedDedupeCampaignIds.length > 0 &&
        emailColumn
      ) {
        const emails = extractUniqueEmailsFromRows(csvRows, emailColumn);
        const preview = await previewCsvEmailsInCampaigns(
          account.id,
          selectedDedupeCampaignIds,
          emails,
        );
        matchingCampaignEmails = preview.matchingEmails;
      }

      if (dedupePreviewRequestRef.current !== requestId) return;

      const result = runCsvDedupePipeline(csvRows, {
        dedupeWithinFile: true,
        filterInCampaigns: filterInCampaignsEnabled,
        filterBlockList: filterBlockListEnabled,
        emailColumn,
        matchingCampaignEmails,
        blockListEntries: blockList,
      });
      setDedupeResult(result);
    } catch (error) {
      if (dedupePreviewRequestRef.current !== requestId) return;
      const message = error instanceof Error ? error.message : 'Failed to check campaigns.';
      setDedupePreviewError(message);
      const result = runCsvDedupePipeline(csvRows, {
        dedupeWithinFile: true,
        filterInCampaigns: false,
        filterBlockList: filterBlockListEnabled,
        emailColumn,
        matchingCampaignEmails: new Set(),
        blockListEntries: blockList,
      });
      setDedupeResult(result);
    } finally {
      if (dedupePreviewRequestRef.current === requestId) {
        setDedupePreviewLoading(false);
      }
    }
  }, [
    account?.id,
    blockList,
    csvRows,
    fieldMappings.email,
    filterBlockListEnabled,
    filterInCampaignsEnabled,
    selectedDedupeCampaignIds,
  ]);

  useEffect(() => {
    if (!isImportWizardOpen || csvStep !== 2) return;
    const timer = setTimeout(() => {
      void computeDedupePreview();
    }, csvStep === 2 ? 300 : 0);
    return () => clearTimeout(timer);
  }, [
    computeDedupePreview,
    csvStep,
    isImportWizardOpen,
    filterInCampaignsEnabled,
    filterBlockListEnabled,
    selectedDedupeCampaignIds,
  ]);

  useEffect(() => {
    if (!isImportWizardOpen || !account?.id) return;
    getCampaignsListSummary(account.id)
      .then((rows) => setCampaignSummaries(rows))
      .catch(() => setCampaignSummaries([]));
  }, [account?.id, isImportWizardOpen]);

  const selectedCampaignNames = useMemo(() => {
    const byId = new Map(campaignSummaries.map((campaign) => [campaign.id, campaign.name]));
    return selectedDedupeCampaignIds
      .map((id) => byId.get(id))
      .filter((name): name is string => Boolean(name));
  }, [campaignSummaries, selectedDedupeCampaignIds]);

  const handleFilterInCampaignsChange = (enabled: boolean) => {
    setFilterInCampaignsEnabled(enabled);
    if (!enabled) {
      setSelectedDedupeCampaignIds([]);
    }
  };

  const resetCsvFlow = () => {
    setCsvStep(0);
    setCsvFileName(null);
    setCsvRows([]);
    setCsvColumns([]);
    setFieldMappings(createEmptyMappings());
    setCustomFieldColumns([]);
    setCustomFieldMappings({});
    setImportSummary(null);
    setDedupeResult(null);
    setDedupePreviewError(null);
    setDedupePreviewLoading(false);
    setFilterInCampaignsEnabled(false);
    setFilterBlockListEnabled(true);
    setSelectedDedupeCampaignIds([]);
    setImportPhase('idle');
    setImportProgress({ processed: 0, total: 0, message: '' });
    setImportResult(null);
  };

  const handleOpenImportWizard = () => {
    resetCsvFlow();
    setIsImportWizardOpen(true);
  };

  const closeImportWizard = (options?: { preserveData?: boolean }) => {
    if (!options?.preserveData) {
      resetCsvFlow();
    }
    setIsSavingImport(false);
    setImportPhase('idle');
    setIsImportWizardOpen(false);
  };

  const handleCloseImportWizard = useConfirmClose(
    isSavingImport && importPhase !== 'importing',
    () => closeImportWizard(),
    {
      title: 'Leave import?',
      message:
        'Import in progress. Leaving now may leave your upload incomplete. Stay on this page?',
      discardLabel: 'Leave',
      keepLabel: 'Stay',
    },
  );

  const handleWizardReset = () => {
    resetCsvFlow();
  };

  const handleCsvFileSelect = async () => {
    if (!initialData?.campaignId || !initialData?.bucketId) {
      Alert.alert(
        'Missing data',
        "This lead bucket isn't ready yet. Close the modal and try again."
      );
      return;
    }

    if (Platform.OS !== 'web') {
      Alert.alert('Desktop required', 'CSV import is available in the web builder.');
      return;
    }

    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv';
      input.value = '';
      input.onchange = async (event) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) return;

        setIsImporting(true);
        try {
          let text = await file.text();
          if (text.startsWith(UTF8_BOM)) {
            text = text.slice(UTF8_BOM.length);
          }
          const parsed = parseCSV(text);

          if (!parsed.rows.length) {
            Alert.alert(
              'No data found',
              'Check that the file has a header row and at least one data row.'
            );
            return;
          }

          setCsvFileName(file.name);
          setCsvRows(parsed.rows);
          setCsvColumns(parsed.headers);

          const autoMappings = buildAutoMappings(parsed.headers, parsed.normalizedHeaders);
          setFieldMappings(() => ({ ...createEmptyMappings(), ...autoMappings }));
          setCustomFieldColumns([]);

          // Auto-map the campaign's existing personalization keys to CSV columns,
          // avoiding any column already claimed by a standard field mapping.
          const standardColumns = new Set(Object.values(autoMappings).filter(Boolean));
          const autoCustomMappings = autoMapExistingCustomKeys(
            parsed.headers,
            parsed.normalizedHeaders,
            existingCustomKeys,
          );
          const seededCustomMappings: Record<string, string> = {};
          for (const [key, column] of Object.entries(autoCustomMappings)) {
            if (!standardColumns.has(column)) {
              seededCustomMappings[key] = column;
            }
          }
          setCustomFieldMappings(seededCustomMappings);

          setImportSummary(null);
          setCsvStep(1);
        } catch (error: any) {
          const message =
            error?.message ||
            'We ran into an issue parsing that CSV file. If your file has commas inside cells, ensure they\'re in quoted fields (e.g. "Last, First").';
          Alert.alert('Import failed', message);
        } finally {
          setIsImporting(false);
        }
      };

      input.click();
    } catch (error: any) {
      Alert.alert('Import failed', error?.message || 'Unable to select a CSV file.');
      setIsImporting(false);
    }
  };

  const handleFieldMappingChange = (fieldId: FieldKey, column: string) => {
    setFieldMappings(prev => ({
      ...prev,
      [fieldId]: column,
    }));

    if (column) {
      // A column used by a standard field can't also be a new custom column or a
      // personalization mapping.
      setCustomFieldColumns(prev => prev.filter(item => item !== column));
      setCustomFieldMappings(prev => {
        const next: Record<string, string> = {};
        for (const [key, mappedColumn] of Object.entries(prev)) {
          next[key] = mappedColumn === column ? '' : mappedColumn;
        }
        return next;
      });
    }
  };

  const handleCustomFieldMappingChange = (existingKey: string, column: string) => {
    setCustomFieldMappings(prev => ({
      ...prev,
      [existingKey]: column,
    }));

    if (column) {
      // Claiming a column for a personalization key removes it from the new-column
      // pills and clears any standard field that pointed at it.
      setCustomFieldColumns(prev => prev.filter(item => item !== column));
      setFieldMappings(prev => {
        const next = { ...prev };
        for (const field of mappingFields) {
          if (next[field.id] === column) {
            next[field.id] = '';
          }
        }
        return next;
      });
    }
  };

  const toggleCustomFieldColumn = (column: string) => {
    if (standardMappedColumns.has(column)) {
      return;
    }
    if (personalizationMappedColumns.has(column)) {
      return;
    }

    setCustomFieldColumns(prev => {
      if (prev.includes(column)) {
        return prev.filter(item => item !== column);
      }
      return [...prev, column];
    });
  };

  const buildImportSummary = (result: CsvDedupeResult | null = dedupeResult) => {
    const mappedFields = mappingFields.reduce((acc, field) => {
      if (fieldMappings[field.id]) {
        acc[field.id] = fieldMappings[field.id];
      }
      return acc;
    }, {} as Record<FieldKey, string>);

    const personalizationFields = Object.entries(customFieldMappings)
      .filter(([, column]) => Boolean(column))
      .map(([key, column]) => ({ key, column }));

    const mappedSet = new Set<string>([
      ...Object.values(fieldMappings).filter(Boolean),
      ...customFieldColumns,
      ...personalizationFields.map(({ column }) => column),
    ]);
    const unmappedColumns = csvColumns.filter((column) => !mappedSet.has(column));
    const stats = result?.stats ?? null;
    const readyRows = stats?.kept ?? csvRows.length;
    const dedupeRemoved = stats
      ? stats.removedWithinFile + stats.removedInCampaigns + stats.removedBlocked
      : 0;

    setImportSummary({
      totalRows: csvRows.length,
      readyRows,
      dedupeRemoved,
      dedupeStats: stats,
      mappedFields,
      customFields: [...customFieldColumns],
      personalizationFields,
      unmappedColumns,
    });
  };

  const goToNextCsvStep = () => {
    if (csvStep === 0 && !csvColumns.length) {
      Alert.alert('Upload required', 'Select a CSV file before continuing.');
      return;
    }

    if (csvStep === 1 && mappingErrors.length) {
      Alert.alert('Missing mappings', mappingErrors[0]);
      return;
    }

    if (csvStep === 1) {
      setCsvStep(2);
      return;
    }

    if (csvStep === 2) {
      if (filterInCampaignsEnabled && selectedDedupeCampaignIds.length === 0) {
        Alert.alert(
          'Campaigns required',
          'Choose at least one campaign to check against, or turn off “Remove leads already in campaigns”.',
        );
        return;
      }
      if (!dedupeResult || dedupeResult.stats.kept === 0) {
        Alert.alert(
          'No leads to import',
          'All leads were removed by your filters. Adjust settings or upload a different file.',
        );
        return;
      }
      buildImportSummary(dedupeResult);
    }

    if (csvStep < csvSteps.length - 1) {
      setCsvStep(csvStep + 1);
    }
  };

  const goToPreviousCsvStep = () => {
    if (csvStep > 0) {
      setCsvStep(csvStep - 1);
    }
  };

  const handleConfirmImport = async () => {
    if (!importSummary || !dedupeResult) {
      Alert.alert('Review required', 'Review the mapping before importing leads.');
      return;
    }

    if (!initialData?.campaignId || !initialData?.bucketId) {
      Alert.alert('Missing data', 'Campaign ID and Bucket ID are required to import leads.');
      return;
    }

    if (!account?.id) {
      Alert.alert('Missing account', 'Select an account before importing leads.');
      return;
    }

    const rowsToImport = dedupeResult.kept;
    const leadPayloads = mapCsvRowsToLeadPayloads(
      rowsToImport,
      fieldMappings,
      customFieldColumns,
      customFieldMappings,
    );
    const persistedFieldConfig = buildLeadSourceFieldConfig({
      existingCustomFieldKeys: initialData?.customFieldKeys,
      existingMappedStandardFieldKeys: initialData?.mappedStandardFieldKeys,
      newCustomFieldColumns: customFieldColumns,
      fieldMappings,
      hasActiveCsvMapping: csvColumns.length > 0,
    });

    if (leadPayloads.length === 0) {
      Alert.alert('No leads to import', 'We could not find any rows with valid emails after applying your filters.');
      return;
    }

    try {
      setIsSavingImport(true);
      setImportResult(null);
      let importedStats: CsvImportStats;

      if (shouldUseAsyncCsvImport(leadPayloads.length)) {
        setImportPhase('uploading');
        setImportProgress({
          processed: 0,
          total: leadPayloads.length,
          message: 'Uploading your file — don\'t close this tab or the upload will stop.',
        });

        const jobId = await createCsvLeadImportJob(account.id, initialData.campaignId);
        await uploadCsvLeadsToStagingJob(jobId, leadPayloads, (processed, total) => {
          setImportProgress({
            processed,
            total,
            message: `Uploading ${processed.toLocaleString()} of ${total.toLocaleString()}…`,
          });
        });

        await finalizeCsvLeadImportJob(jobId);
        await enqueueCsvImportJob(jobId);

        setImportPhase('importing');
        setImportProgress({
          processed: 0,
          total: leadPayloads.length,
          message:
            'Import is running in the background. You can close this tab — reopen this bucket to see results.',
        });

        const job = await pollCsvImportJobUntilDone(jobId, {
          onProgress: (progress) => {
            setImportProgress((prev) => ({
              ...prev,
              processed: Math.round((progress / 100) * prev.total),
              message: `Importing… ${progress}%`,
            }));
          },
        });

        if (job.status === 'failed') {
          throw new Error('CSV import job failed.');
        }

        importedStats = mapImportJobToCsvResult(job);
        setImportResult(importedStats);
      } else {
        setImportPhase('sync');
        setImportProgress({
          processed: 0,
          total: leadPayloads.length,
          message: 'Keep this tab open until import finishes.',
        });

        importedStats = await importCsvLeadsSync(
          account.id,
          initialData.campaignId,
          leadPayloads,
          (processed, total) => {
            setImportProgress({
              processed,
              total,
              message: `Importing ${processed.toLocaleString()} of ${total.toLocaleString()}…`,
            });
          },
        );

        setImportResult(importedStats);
      }

      // Safety net: with blanks allowed, the only way to end up with nothing
      // created/updated is an unexpected failure (e.g. every row had a blank
      // email). Never report success or auto-close in that case.
      if (importedStats.created + importedStats.updated === 0) {
        const failureDetail =
          importedStats.failed > 0
            ? `${importedStats.failed.toLocaleString()} row${importedStats.failed === 1 ? '' : 's'} failed.`
            : 'Check that your email column is mapped and that rows have valid email addresses.';
        setImportPhase('idle');
        Alert.alert('No leads imported', `We couldn't import any leads. ${failureDetail}`);
        return;
      }

      onSave({
        bucketId: initialData?.bucketId,
        ...persistedFieldConfig,
        keepModalOpen: true,
      });
      Alert.alert('Import complete', buildImportCompleteMessage(importedStats));

      await loadBucketData();
      closeImportWizard({ preserveData: true });
    } catch (error: unknown) {
      console.error('Failed to import leads:', error);
      Alert.alert('Import failed', error instanceof Error ? error.message : 'Unable to save leads right now. Please try again.');
      setImportPhase('idle');
    } finally {
      setIsSavingImport(false);
    }
  };

  const renderImportProgress = () => {
    const pct =
      importProgress.total > 0
        ? Math.min(100, Math.round((importProgress.processed / importProgress.total) * 100))
        : 0;
    const isBackgroundPhase = importPhase === 'importing';

    return (
      <View className="gap-4">
        <View
          className={`p-3 border rounded-xl ${
            isBackgroundPhase
              ? 'border-green-500/40 bg-green-500/10'
              : 'border-yellow-500/40 bg-yellow-500/10'
          }`}
        >
          <Text
            className={`text-sm font-instrument-medium ${
              isBackgroundPhase ? 'text-green-300' : 'text-yellow-200'
            }`}
          >
            {importProgress.message}
          </Text>
        </View>
        <View className="gap-2">
          <View
            style={{
              height: 8,
              borderRadius: 999,
              backgroundColor: 'rgba(255,255,255,0.08)',
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${pct}%`,
                height: '100%',
                backgroundColor: '#F3440D',
              }}
            />
          </View>
          <Text className="text-xs text-gray-400">
            {importProgress.processed.toLocaleString()} of {importProgress.total.toLocaleString()}
          </Text>
        </View>
        {importResult ? (
          <View className="p-3 border border-white/10 rounded-xl bg-white/5">
            <Text className="text-sm text-white font-instrument-medium">
              Created {importResult.created.toLocaleString()} · Updated {importResult.updated.toLocaleString()}
            </Text>
            {importResult.incomplete > 0 ? (
              <Text className="text-xs text-yellow-200 mt-1">
                {importResult.incomplete.toLocaleString()} with missing personalization fields
              </Text>
            ) : null}
            {importResult.failed > 0 ? (
              <Text className="text-xs text-red-300 mt-1">
                {importResult.failed.toLocaleString()} failed
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };

  const renderCsvStepContent = () => {
    if (isSavingImport) {
      return renderImportProgress();
    }

    switch (csvStep) {
      case 0:
        return (
          <View className="gap-4">
            <Text className="text-sm text-gray-300 font-instrument-medium">
              Upload a CSV file to stage leads for this bucket.
            </Text>
            <Button onPress={handleCsvFileSelect} disabled={isImporting}>
              {isImporting ? 'Processing…' : 'Choose CSV File'}
            </Button>
            {csvFileName && (
              <View className="p-3 border border-white/10 rounded-lg bg-white/5">
                <Text className="text-white text-sm font-instrument-medium">{csvFileName}</Text>
                <Text className="text-xs text-gray-400 mt-1">
                  {csvRows.length} rows detected · {csvColumns.length} columns
                </Text>
              </View>
            )}
            {previewRows.length > 0 && (
              <View className="gap-2">
                <Text className="text-xs text-gray-400 uppercase tracking-[0.2em]">Preview</Text>
                <View className="border border-white/10 rounded-lg overflow-hidden">
                  <View style={{ flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 12, paddingVertical: 10 }}>
                    {displayColumns.map(column => (
                      <View key={column} style={{ flex: 1, paddingRight: 12 }}>
                        <Text style={{ color: '#D1D5DB', fontSize: 12, fontWeight: '600', fontFamily: 'Instrument Sans, system-ui, sans-serif' }}>
                          {column}
                        </Text>
                      </View>
                    ))}
                  </View>
                  {previewRows.map((row, rowIndex) => (
                    <View key={rowIndex} style={{ flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)' }}>
                      {displayColumns.map(column => (
                        <View key={column} style={{ flex: 1, paddingRight: 12 }}>
                          <Text numberOfLines={1} style={{ color: '#9CA3AF', fontSize: 12, fontFamily: 'Instrument Sans, system-ui, sans-serif' }}>
                            {row[column] ?? ''}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
                {hiddenColumnCount > 0 && (
                  <Text className="text-xs text-gray-500">
                    +{hiddenColumnCount} more column{hiddenColumnCount === 1 ? '' : 's'} not shown
                  </Text>
                )}
              </View>
            )}
          </View>
        );
      case 1:
        return (
          <View className="gap-4">
            {mappingFields.map(field => {
              const mappedColumn = fieldMappings[field.id];
              const fieldError = field.required && !mappedColumn;
              return (
                <View
                  key={field.id}
                  style={{
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.12)',
                    borderRadius: 12,
                    backgroundColor: 'rgba(255,255,255,0.05)',
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                    marginBottom: 10,
                  }}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 16,
                      flexWrap: 'wrap',
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#FFFFFF', fontSize: 14, fontFamily: 'Instrument Sans, system-ui, sans-serif', fontWeight: '600' }}>
                        {field.label}
                        {field.required ? ' *' : ''}
                      </Text>
                    </View>
                    <Text
                      style={{
                        color: mappedColumn ? '#34D399' : field.required ? '#F87171' : '#9CA3AF',
                        fontSize: 12,
                        fontFamily: 'Instrument Sans, system-ui, sans-serif',
                        fontWeight: '600',
                        minWidth: 90,
                        textAlign: 'right',
                      }}
                    >
                      {mappedColumn ? 'Mapped' : field.required ? 'Required' : 'Optional'}
                    </Text>
                    {Platform.OS === 'web' ? (
                      <select
                        value={mappedColumn}
                        onChange={(event) => handleFieldMappingChange(field.id, event.target.value)}
                        style={{
                          minWidth: 180,
                          backgroundColor: 'rgba(0,0,0,0.35)',
                          borderColor: fieldError ? '#F87171' : 'rgba(255,255,255,0.2)',
                          borderWidth: 1,
                          borderRadius: 10,
                          padding: '8px 12px',
                          color: '#FFFFFF',
                          fontSize: 13,
                          fontFamily: 'Instrument Sans, system-ui, sans-serif',
                        }}
                      >
                        <option value="">Select column…</option>
                        {csvColumns.map(column => (
                          <option value={column} key={column}>{column}</option>
                        ))}
                      </select>
                    ) : (
                      <Text style={{ color: '#9CA3AF', fontSize: 12 }}>
                        Mapping is currently available in the web builder.
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}

            {existingCustomKeys.length > 0 && (
              <View className="p-3 border border-white/10 rounded-xl bg-white/5">
                <Text className="text-sm text-white font-instrument-medium mb-2">
                  Personalization fields
                </Text>
                <Text className="text-xs text-gray-400 mb-3">
                  This campaign already uses these custom fields. Map a column to fill them — leaving one blank still imports the lead (it will be counted as incomplete).
                </Text>
                {existingCustomKeys.map((key) => {
                  const mappedColumn = customFieldMappings[key] ?? '';
                  const keyInvalid = !isValidCustomFieldKey(key);
                  return (
                    <View
                      key={key}
                      style={{
                        borderWidth: 1,
                        borderColor: keyInvalid ? 'rgba(248,113,113,0.5)' : 'rgba(255,255,255,0.12)',
                        borderRadius: 12,
                        backgroundColor: 'rgba(255,255,255,0.04)',
                        paddingVertical: 10,
                        paddingHorizontal: 14,
                        marginBottom: 10,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: '#FFFFFF', fontSize: 14, fontFamily: 'Instrument Sans, system-ui, sans-serif', fontWeight: '600' }}>
                            {key}
                          </Text>
                          {keyInvalid ? (
                            <Text style={{ color: '#F87171', fontSize: 11, marginTop: 2 }}>
                              Contains "{'{'}" or "{'}'}" — can't be imported until renamed.
                            </Text>
                          ) : null}
                        </View>
                        <Text
                          style={{
                            color: mappedColumn ? '#34D399' : '#9CA3AF',
                            fontSize: 12,
                            fontFamily: 'Instrument Sans, system-ui, sans-serif',
                            fontWeight: '600',
                            minWidth: 90,
                            textAlign: 'right',
                          }}
                        >
                          {mappedColumn ? 'Mapped' : 'Optional'}
                        </Text>
                        {Platform.OS === 'web' ? (
                          <select
                            value={mappedColumn}
                            disabled={keyInvalid}
                            onChange={(event) => handleCustomFieldMappingChange(key, event.target.value)}
                            style={{
                              minWidth: 180,
                              backgroundColor: 'rgba(0,0,0,0.35)',
                              borderColor: 'rgba(255,255,255,0.2)',
                              borderWidth: 1,
                              borderRadius: 10,
                              padding: '8px 12px',
                              color: '#FFFFFF',
                              fontSize: 13,
                              fontFamily: 'Instrument Sans, system-ui, sans-serif',
                              opacity: keyInvalid ? 0.4 : 1,
                            }}
                          >
                            <option value="">Select column…</option>
                            {csvColumns.map((column) => (
                              <option value={column} key={column}>{column}</option>
                            ))}
                          </select>
                        ) : (
                          <Text style={{ color: '#9CA3AF', fontSize: 12 }}>
                            Mapping is currently available in the web builder.
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            <View className="p-3 border border-white/10 rounded-xl bg-white/5">
              <Text className="text-sm text-white font-instrument-medium mb-2">
                New custom fields
              </Text>
              <Text className="text-xs text-gray-400 mb-3">
                Tag any additional columns you want stored as new personalization fields.
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {availableCustomPillColumns.map(column => {
                  const isSelected = customFieldColumns.includes(column);
                  const columnInvalid = !isValidCustomFieldKey(column);
                  return (
                    <TouchableOpacity
                      key={column}
                      disabled={columnInvalid}
                      onPress={() => toggleCustomFieldColumn(column)}
                      style={{
                        borderRadius: 999,
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        backgroundColor: isSelected ? 'rgba(243,68,13,0.25)' : 'rgba(255,255,255,0.05)',
                        borderWidth: 1,
                        borderColor: columnInvalid ? 'rgba(248,113,113,0.5)' : isSelected ? '#F3440D' : 'rgba(255,255,255,0.12)',
                        opacity: columnInvalid ? 0.4 : 1,
                      }}
                    >
                      <Text style={{ color: '#FFFFFF', fontSize: 12, fontFamily: 'Instrument Sans, system-ui, sans-serif' }}>
                        {column}
                        {columnInvalid ? ' (invalid name)' : ''}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {availableCustomPillColumns.length === 0 && (
                  <Text className="text-xs text-gray-400">
                    {csvColumns.length === 0
                      ? 'Upload a CSV to manage custom fields.'
                      : 'No additional columns to add as new custom fields.'}
                  </Text>
                )}
              </View>
            </View>

            {mappingErrors.length > 0 && (
              <View className="p-3 border border-red-500/40 bg-red-500/10 rounded-lg">
                {mappingErrors.map((error, index) => (
                  <Text key={index} className="text-xs text-red-300">
                    • {error}
                  </Text>
                ))}
              </View>
            )}
          </View>
        );
      case 2:
        return (
          <CsvImportDedupeStep
            isCompactLayout={isDedupeCompactLayout}
            filterInCampaignsEnabled={filterInCampaignsEnabled}
            onFilterInCampaignsChange={handleFilterInCampaignsChange}
            filterBlockListEnabled={filterBlockListEnabled}
            onFilterBlockListChange={setFilterBlockListEnabled}
            selectedDedupeCampaignIds={selectedDedupeCampaignIds}
            selectedCampaignNames={selectedCampaignNames}
            onOpenCampaignPicker={() => setShowCampaignPicker(true)}
            dedupeResult={dedupeResult}
            dedupePreviewLoading={dedupePreviewLoading}
            dedupePreviewError={dedupePreviewError}
          />
        );
      case 3:
        return (
          <CsvImportReviewStep fileName={csvFileName} summary={reviewSummary} />
        );
      default:
        return null;
    }
  };

  const renderMainContent = () => {
    if (isLoadingBucket) {
      return <LeadSourceBucketSkeleton />;
    }

    const leadTotal = leadCount ?? 0;
    const hasLeads = leadTotal > 0;

    if (!hasLeads) {
      return (
        <EmptyState
          title="No leads yet"
          description="Import a CSV to add leads to this bucket."
          actionText="Import leads"
          onAction={handleOpenImportWizard}
        />
      );
    }

    return (
      <View className="gap-4">
        <View className="flex-row flex-wrap items-center justify-between gap-3">
          <View className="flex-1 min-w-0">
            <Text className="text-sm text-white font-instrument-medium">
              {leadTotal.toLocaleString()} lead{leadTotal === 1 ? '' : 's'} in bucket
            </Text>
            <Text className="text-xs text-gray-400 mt-1 font-instrument">
              Showing field coverage across imported records.
            </Text>
          </View>
          <Button onPress={handleOpenImportWizard}>Import more leads</Button>
        </View>

        <DataTable
          items={bucketTableRows}
          columns={bucketTableColumns}
          itemsPerPage={BUCKET_TABLE_PAGE_SIZE}
          paginationMode="server"
          currentPage={tablePage}
          totalItems={leadTotal}
          onPageChange={handleTablePageChange}
          loading={isTableLoading}
          smoothLoading
          emptyMessage="No sample records"
          getItemKey={(item) => item.__rowKey}
        />
      </View>
    );
  };

  const renderImportWizardModal = () => {
    if (!isImportWizardOpen) {
      return null;
    }

    const isLastStep = csvStep === csvSteps.length - 1 && !isSavingImport;

    const wizardFooter = (
      <View className="flex-row items-center justify-between">
        <Button
          variant="secondary"
          size="sm"
          onPress={goToPreviousCsvStep}
          disabled={csvStep === 0 || isSavingImport}
        >
          Back
        </Button>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Button
            variant="secondary"
            size="sm"
            onPress={handleWizardReset}
            disabled={!csvColumns.length || isSavingImport}
          >
            Reset
          </Button>

          <Button
            onPress={isLastStep ? handleConfirmImport : goToNextCsvStep}
            disabled={isLastStep ? !importSummary || isSavingImport : isNextDisabled}
          >
            {isLastStep ? (isSavingImport ? 'Importing…' : 'Import Leads') : 'Next'}
          </Button>
        </View>
      </View>
    );

    const wizardFooterMobile = (
      <ModalFooter>
        <Button
          onPress={isLastStep ? handleConfirmImport : goToNextCsvStep}
          disabled={isLastStep ? !importSummary || isSavingImport : isNextDisabled}
        >
          {isLastStep ? (isSavingImport ? 'Importing…' : 'Import Leads') : 'Next'}
        </Button>
      </ModalFooter>
    );

    return (
      <>
        <BaseModal
          visible={isImportWizardOpen}
          onClose={handleCloseImportWizard}
          title="Import Leads"
          description="Upload a CSV, map fields, configure dedupe, and review before importing leads"
          footer={wizardFooter}
          footerMobile={wizardFooterMobile}
          maxWidth="3xl"
          maxHeight={Math.min(780, Math.round(windowHeight * 0.82))}
          overlayZIndex={1000}
        >
          <CsvImportWizardContentShell>
            <WizardStepIndicator steps={csvSteps} activeIndex={csvStep} wrap />
            {renderCsvStepContent()}
          </CsvImportWizardContentShell>
        </BaseModal>
        <CampaignPickerModal
          visible={showCampaignPicker}
          onClose={() => setShowCampaignPicker(false)}
          accountId={account?.id ?? null}
          selectedCampaignIds={selectedDedupeCampaignIds}
          onSelectionChange={setSelectedDedupeCampaignIds}
          overlayZIndex={1100}
        />
      </>
    );
  };

  return (
    <>
      <BaseModal
        visible={visible}
        onClose={onClose}
        title="Lead bucket"
        description="Review imported leads or import more from CSV"
        maxWidth="full"
        height={Math.round(windowHeight * 0.9)}
      >
        {renderMainContent()}
      </BaseModal>

      {renderImportWizardModal()}
    </>
  );
}

export { LeadSourceNodeModal };
export default LeadSourceNodeModal;

