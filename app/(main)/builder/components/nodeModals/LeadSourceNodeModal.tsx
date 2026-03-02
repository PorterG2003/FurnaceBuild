import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Platform, Alert, useWindowDimensions } from 'react-native';
import Papa from 'papaparse';
import { BaseModal } from '@/components/ui/modals';
import { Tabs } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import { useAccount } from '@/contexts/AccountContext';
import { createLeads, generateGlobalLeadId, getLeadCount, getLeads } from '@/lib/supabase/services/leads';
import { ensureCampaignEnrollmentsForLeads } from '@/lib/supabase/services/campaigns';
import type { LeadInsert, Lead } from '@/lib/supabase/types';

interface LeadSourceNodeModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (data: {
    label?: string;
    source?: string;
    bucketId?: string;
    customFieldKeys?: string[];
    mappedStandardFieldKeys?: string[];
  }) => void;
  initialData?: {
    label?: string;
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

const leadSourceTabs = [
  { id: 'details', label: 'Details' },
  { id: 'csv', label: 'Import' },
  { id: 'api', label: 'API' },
  { id: 'insights', label: 'Insights' },
] as const;

type TabId = typeof leadSourceTabs[number]['id'];

const csvSteps = ['Upload CSV', 'Map Fields', 'Review'] as const;

const mappingFields = [
  { id: 'email', label: 'Email Address', required: true },
  { id: 'name', label: 'Full Name', required: false },
  { id: 'first_name', label: 'First Name', required: false },
  { id: 'last_name', label: 'Last Name', required: false },
  { id: 'company_name', label: 'Company Name', required: false },
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
  const { account } = useAccount();
  const [label, setLabel] = useState(initialData?.label || 'Lead Bucket');
  const [activeTab, setActiveTab] = useState<TabId>('details');
  const [isImporting, setIsImporting] = useState(false);
  const [isSavingImport, setIsSavingImport] = useState(false);
  const [csvStep, setCsvStep] = useState(0);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [fieldMappings, setFieldMappings] = useState<Record<FieldKey, string>>(() => createEmptyMappings());
  const [customFieldColumns, setCustomFieldColumns] = useState<string[]>([]);
  const [importSummary, setImportSummary] = useState<{
    totalRows: number;
    mappedFields: Record<FieldKey, string>;
    customFields: string[];
    unmappedColumns: string[];
  } | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [apiKey] = useState(() => `live_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`);
  const [isImportWizardOpen, setIsImportWizardOpen] = useState(false);
  const [dbLeads, setDbLeads] = useState<Lead[]>([]);
  const [leadCount, setLeadCount] = useState<number | null>(null);
  const [isLoadingLeads, setIsLoadingLeads] = useState(false);
  const { height: windowHeight } = useWindowDimensions();

  const displayColumns = useMemo(() => csvColumns.slice(0, 6), [csvColumns]);
  const hiddenColumnCount = csvColumns.length > displayColumns.length ? csvColumns.length - displayColumns.length : 0;

  const mappingErrors = useMemo(() => {
    const errors: string[] = [];
    if (!fieldMappings.email) {
      errors.push('Email must be mapped to import leads.');
    }
    return errors;
  }, [fieldMappings]);

  const previewRows = useMemo(() => csvRows.slice(0, 3), [csvRows]);

  // Fetch leads from database when modal opens and Insights tab is active
  useEffect(() => {
    if (visible && activeTab === 'insights' && initialData?.campaignId) {
      const fetchLeads = async () => {
        setIsLoadingLeads(true);
        try {
          const filters: { campaignId?: string; bucketId?: string } = {
            campaignId: initialData.campaignId,
          };
          
          // If bucketId is available, filter by bucket; otherwise get all campaign leads
          if (initialData.bucketId) {
            filters.bucketId = initialData.bucketId;
          }
          
          const [count, leads] = await Promise.all([
            getLeadCount(filters),
            getLeads({ ...filters, limit: 200 }),
          ]);
          setLeadCount(count);
          setDbLeads(leads);
        } catch (error) {
          console.error('Failed to fetch leads for insights:', error);
          setLeadCount(null);
          setDbLeads([]);
        } finally {
          setIsLoadingLeads(false);
        }
      };
      
      fetchLeads();
    }
  }, [visible, activeTab, initialData?.campaignId, initialData?.bucketId]);

  // Convert database leads to the format needed for insights
  const leadsForInsights = useMemo(() => {
    if (dbLeads.length === 0) {
      return csvRows; // Fallback to CSV rows if no DB leads
    }
    
    // Convert Lead objects to Record<string, string> format
    return dbLeads.map(lead => {
      const record: Record<string, string> = {};

      // Map all lead fields from database schema
      if (lead.email) record.email = lead.email;
      if (lead.name) record.name = lead.name;
      if (lead.first_name) record.first_name = lead.first_name;
      if (lead.last_name) record.last_name = lead.last_name;
      if (lead.company_name) record.company_name = lead.company_name;
      if (lead.website) record.website = lead.website;
      if (lead.linkedin_url) record.linkedin_url = lead.linkedin_url;
      if (lead.company_linkedin_url) record.company_linkedin_url = lead.company_linkedin_url;
      if (lead.source) record.source = lead.source;
      if (lead.status) record.status = lead.status;

      // Add any custom lead data if it exists
      if (lead.custom_lead_data && typeof lead.custom_lead_data === 'object') {
        Object.entries(lead.custom_lead_data).forEach(([key, value]) => {
          if (value !== null && value !== undefined) {
            record[key] = String(value);
          }
        });
      }

      return record;
    });
  }, [dbLeads, csvRows]);

  const insightSummary = useMemo(() => {
    const dataToAnalyze = leadsForInsights.length > 0 ? leadsForInsights : csvRows;
    
    if (!dataToAnalyze.length) {
      return {
        totalRows: 0,
        fields: [] as Array<{ field: string; percentage: number }>,
        examples: [] as Record<string, string>[],
      };
    }

    const fieldCounts = new Map<string, number>();
    dataToAnalyze.forEach(row => {
      Object.entries(row).forEach(([field, value]) => {
        if ((value ?? '').toString().trim()) {
          fieldCounts.set(field, (fieldCounts.get(field) || 0) + 1);
        }
      });
    });

    const totalRows = dataToAnalyze.length;
    const fields = Array.from(fieldCounts.entries())
      .map(([field, count]) => ({
        field,
        percentage: Math.min(100, Math.round((count / totalRows) * 100)),
      }))
      .sort((a, b) => b.percentage - a.percentage);

    return {
      totalRows,
      fields,
      examples: dataToAnalyze.slice(0, 3),
    };
  }, [leadsForInsights, csvRows]);

  const endpointUrl = useMemo(() => {
    const bucketSegment = initialData?.bucketId ?? 'your-bucket-id';
    return `https://api.furnace.build/v1/buckets/${bucketSegment}/leads`;
  }, [initialData?.bucketId]);

  const payloadExample = useMemo(() => {
    const bucketSegment = initialData?.bucketId ?? 'your-bucket-id';
    return `{
  "bucket_id": "${bucketSegment}",
  "leads": [
    {
      "email": "jane@example.com",
      "name": "Jane Doe",
      "first_name": "Jane",
      "last_name": "Doe",
      "company_name": "Acme Co",
      "website": "https://www.acmeco.com",
      "linkedin_url": "https://www.linkedin.com/in/janedoe",
      "company_linkedin_url": "https://www.linkedin.com/company/acme-co",
      "custom_lead_data": {
        "company": "Acme Co",
        "source": "Landing Page"
      }
    }
  ]
}`;
  }, [initialData?.bucketId]);

  const isNextDisabled = isSavingImport
    ? true
    : csvStep === 0
    ? csvColumns.length === 0
    : csvStep === 1
      ? mappingErrors.length > 0
      : false;

  const handleSave = () => {
    const customFieldKeys = Array.from(
      new Set([...(initialData?.customFieldKeys ?? []), ...customFieldColumns])
    );
    const mappedStandardFieldKeys =
      csvColumns.length > 0
        ? (Object.entries(fieldMappings).filter(([, col]) => col?.trim()).map(([key]) => key) as string[])
        : (initialData?.mappedStandardFieldKeys ?? undefined);

    onSave({
      label,
      bucketId: initialData?.bucketId,
      customFieldKeys,
      mappedStandardFieldKeys,
    });
    onClose();
  };

  const resetCsvFlow = (options?: { resetCount?: boolean }) => {
    setCsvStep(0);
    setCsvFileName(null);
    setCsvRows([]);
    setCsvColumns([]);
    setFieldMappings(createEmptyMappings());
    setCustomFieldColumns([]);
    setImportSummary(null);
    if (options?.resetCount) {
      setImportedCount(null);
    }
  };

  const handleOpenImportWizard = () => {
    resetCsvFlow();
    setIsImportWizardOpen(true);
  };

  const handleCloseImportWizard = (options?: { preserveData?: boolean }) => {
    if (!options?.preserveData) {
      resetCsvFlow();
    }
    setIsSavingImport(false);
    setIsImportWizardOpen(false);
  };

  const handleWizardReset = () => {
    resetCsvFlow({ resetCount: true });
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
          setImportSummary(null);
          setImportedCount(null);
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
      setCustomFieldColumns(prev => prev.filter(item => item !== column));
    }
  };

  const toggleCustomFieldColumn = (column: string) => {
    if (Object.values(fieldMappings).includes(column)) {
      return;
    }

    setCustomFieldColumns(prev => {
      if (prev.includes(column)) {
        return prev.filter(item => item !== column);
      }
      return [...prev, column];
    });
  };

  const buildImportSummary = () => {
    const mappedFields = mappingFields.reduce((acc, field) => {
      if (fieldMappings[field.id]) {
        acc[field.id] = fieldMappings[field.id];
      }
      return acc;
    }, {} as Record<FieldKey, string>);

    const mappedSet = new Set<string>([...Object.values(fieldMappings).filter(Boolean), ...customFieldColumns]);
    const unmappedColumns = csvColumns.filter(column => !mappedSet.has(column));

    setImportSummary({
      totalRows: csvRows.length,
      mappedFields,
      customFields: [...customFieldColumns],
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
      buildImportSummary();
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
    if (!importSummary) {
      Alert.alert('Review required', 'Review the mapping before importing leads.');
      return;
    }

    if (!initialData?.campaignId || !initialData?.bucketId) {
      Alert.alert('Missing data', 'Campaign ID and Bucket ID are required to import leads.');
      return;
    }

    if (csvRows.length === 0) {
      Alert.alert('No data', 'Upload a CSV file before importing.');
      return;
    }

    try {
      setIsSavingImport(true);

      const sanitizeValue = (value?: string): string | null => {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
      };

      const leadsToSave = (await Promise.all(
        csvRows.map(async (row) => {
          const valueForColumn = (columnName?: string) => sanitizeValue(columnName ? row[columnName] : undefined);

          const email = valueForColumn(fieldMappings.email);
          const firstName = valueForColumn(fieldMappings.first_name);
          const lastName = valueForColumn(fieldMappings.last_name);
          const combinedName = valueForColumn(fieldMappings.name);
          const companyName = valueForColumn(fieldMappings.company_name);
          const website = valueForColumn(fieldMappings.website);
          const linkedinUrl = valueForColumn(fieldMappings.linkedin_url);
          const companyLinkedinUrl = valueForColumn(fieldMappings.company_linkedin_url);

          const derivedName =
            combinedName ||
            [firstName, lastName].filter(Boolean).join(' ').trim() ||
            null;

          const customData = customFieldColumns.reduce<Record<string, string>>((acc, column) => {
            const value = valueForColumn(column);
            if (value !== null) {
              acc[column] = value;
            }
            return acc;
          }, {});

          const hasPrimaryFields = email || derivedName || firstName || lastName || companyName;
          if (!hasPrimaryFields && Object.keys(customData).length === 0) {
            return null;
          }

          if (!account?.id) throw new Error('No account selected');
          const lead: LeadInsert = {
            campaign_id: initialData.campaignId!,
            bucket_id: initialData.bucketId!,
            account_id: account.id,
            email,
            name: derivedName,
            first_name: firstName,
            last_name: lastName,
            company_name: companyName,
            website,
            linkedin_url: linkedinUrl,
            company_linkedin_url: companyLinkedinUrl,
            source: initialData?.source || 'CSV Import',
            status: 'new',
          };

          if (Object.keys(customData).length > 0) {
            lead.custom_lead_data = customData;
          }

          if (email) {
            lead.global_lead_id = await generateGlobalLeadId(email);
          }

          return lead;
        })
      )).filter((lead): lead is LeadInsert => lead !== null);

      if (leadsToSave.length === 0) {
        Alert.alert('No leads to import', 'We could not find any rows with data after applying your mappings.');
        return;
      }

      const savedLeads = await createLeads(leadsToSave);
      if (initialData.campaignId && savedLeads.length > 0) {
        await ensureCampaignEnrollmentsForLeads(
          initialData.campaignId,
          savedLeads.map((lead) => lead.id)
        );
      }

      setImportedCount(savedLeads.length);
      Alert.alert('Import complete', `Successfully saved ${savedLeads.length} lead${savedLeads.length === 1 ? '' : 's'}.`);
      handleCloseImportWizard({ preserveData: true });
      setActiveTab('insights');
    } catch (error: any) {
      console.error('Failed to import leads:', error);
      Alert.alert('Import failed', error?.message || 'Unable to save leads right now. Please try again.');
    } finally {
      setIsSavingImport(false);
    }
  };

  const handleCopy = (value: string, label: string) => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(() => {
        Alert.alert('Copied', `${label} copied to clipboard.`);
      }).catch(() => {
        Alert.alert('Copy failed', 'Unable to copy to clipboard.');
      });
    } else {
      Alert.alert('Clipboard', 'Copy to clipboard is available in the web builder.');
    }
  };

  const handleTestEndpoint = () => {
    setTestStatus('loading');
    setTimeout(() => {
      setTestStatus('success');
      Alert.alert('Test mode', 'Mock request sent. Hook up the backend handler to complete this action.');
    }, 650);
  };

  const renderDetailsTab = () => (
      <View className="gap-4">
        <View>
          <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
            Label
          </Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="Node label"
            placeholderTextColor="#666"
            className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
            style={{
              borderColor: '#FFFFFF4D',
              backgroundColor: '#FFFFFF0D',
              color: '#FFFFFF',
              borderWidth: 1,
            }}
            selectionColor="#FF4D00"
            underlineColorAndroid="transparent"
          />
        </View>

      <View className="p-4 border border-white/10 rounded-xl bg-white/5">
        <Text className="text-sm text-white font-instrument-medium">
          Lead Source Overview
        </Text>
        <Text className="text-xs text-gray-400 mt-2">
          Use the tabs above to import leads from CSV, connect an API endpoint, and understand the structure of your data.
        </Text>
      </View>

      {importedCount !== null && (
        <View className="p-4 border border-green-500/40 bg-green-500/10 rounded-xl">
          <Text className="text-sm text-green-300 font-instrument-medium">
            {importedCount} leads prepared for import
          </Text>
          <Text className="text-xs text-green-200/80 mt-1">
            Switch to Lead Insights to preview example records and field coverage.
          </Text>
        </View>
      )}
    </View>
  );

  const renderCsvStepContent = () => {
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

            <View className="p-3 border border-white/10 rounded-xl bg-white/5">
              <Text className="text-sm text-white font-instrument-medium mb-2">
                Custom Lead Fields
              </Text>
              <Text className="text-xs text-gray-400 mb-3">
                Tag any additional columns you want stored in custom_lead_data.
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {csvColumns.map(column => {
                  const isMapped = Object.values(fieldMappings).includes(column);
                  const isSelected = customFieldColumns.includes(column);
                  return (
                    <TouchableOpacity
                      key={column}
                      disabled={isMapped}
                      onPress={() => toggleCustomFieldColumn(column)}
                      style={{
                        borderRadius: 999,
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        backgroundColor: isSelected ? 'rgba(243,68,13,0.25)' : 'rgba(255,255,255,0.05)',
                        borderWidth: 1,
                        borderColor: isSelected ? '#F3440D' : 'rgba(255,255,255,0.12)',
                        opacity: isMapped ? 0.4 : 1,
                      }}
                    >
                      <Text style={{ color: '#FFFFFF', fontSize: 12, fontFamily: 'Instrument Sans, system-ui, sans-serif' }}>
                        {column}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {csvColumns.length === 0 && (
                  <Text className="text-xs text-gray-400">
                    Upload a CSV to manage custom fields.
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
          <View className="gap-4">
            {importSummary ? (
              <>
                <View className="p-3 border border-white/10 rounded-xl bg-white/5">
                  <Text className="text-sm text-white font-instrument-medium">
                    {importSummary.totalRows} leads ready
                  </Text>
                  <Text className="text-xs text-gray-400 mt-1">
                    Review the mapping before finalizing the import.
                  </Text>
                </View>

                <View className="p-3 border border-white/10 rounded-xl bg-white/5">
                  <Text className="text-xs text-gray-400 uppercase tracking-[0.2em] mb-2">
                    Field Mapping
                  </Text>
                  {Object.entries(importSummary.mappedFields).length > 0 ? (
                    Object.entries(importSummary.mappedFields).map(([field, column]) => (
                      <View key={field} className="flex-row justify-between py-1.5">
                        <Text className="text-sm text-gray-300 capitalize">{field}</Text>
                        <Text className="text-sm text-white font-instrument-medium">{column}</Text>
                      </View>
                    ))
                  ) : (
                    <Text className="text-sm text-gray-400">
                      No fields mapped yet.
                    </Text>
                  )}
                </View>

                <View className="p-3 border border-white/10 rounded-xl bg-white/5">
                  <Text className="text-xs text-gray-400 uppercase tracking-[0.2em] mb-2">
                    Custom Fields
                  </Text>
                  {importSummary.customFields.length > 0 ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {importSummary.customFields.map(field => (
                        <View key={field} style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.08)' }}>
                          <Text style={{ color: '#FFFFFF', fontSize: 12 }}>{field}</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text className="text-sm text-gray-400">
                      No extra fields selected.
                    </Text>
                  )}
                </View>

                {importSummary.unmappedColumns.length > 0 && (
                  <View className="p-3 border border-yellow-500/40 bg-yellow-500/10 rounded-xl">
                    <Text className="text-sm text-yellow-200 font-instrument-medium mb-1">
                      {importSummary.unmappedColumns.length} column{importSummary.unmappedColumns.length === 1 ? '' : 's'} left unmapped
                    </Text>
                    <Text className="text-xs text-yellow-200/80">
                      {importSummary.unmappedColumns.join(', ')}
                    </Text>
                  </View>
                )}

                {importedCount !== null && (
                  <View className="p-3 border border-green-500/40 bg-green-500/10 rounded-xl">
                    <Text className="text-sm text-green-300 font-instrument-medium">
                      Imported {importedCount} lead{importedCount === 1 ? '' : 's'} into this bucket
                    </Text>
                    <Text className="text-xs text-green-200/80 mt-1">
                      Connect downstream workflows to act on the newly added leads.
                    </Text>
                  </View>
                )}
              </>
            ) : (
              <View className="p-3 border border-white/10 rounded-xl bg-white/5">
                <Text className="text-sm text-gray-300">
                  Complete the field mapping to review your import.
                </Text>
              </View>
            )}
          </View>
        );
      default:
        return null;
    }
  };

  const renderImportTab = () => (
    <View className="gap-4">
      <View className="p-4 border border-white/10 rounded-xl bg-white/5 gap-3">
        <View className="gap-1">
          <Text className="text-sm text-white font-instrument-medium">
            CSV Import Wizard
          </Text>
          <Text className="text-xs text-gray-400">
            Launch the step-by-step wizard to upload a CSV, map your fields, and prepare leads for this bucket.
          </Text>
        </View>
        <Button onPress={handleOpenImportWizard}>
          Start Import
        </Button>
      </View>

      {importedCount !== null && (
        <View className="p-4 border border-green-500/40 bg-green-500/10 rounded-xl">
          <Text className="text-sm text-green-300 font-instrument-medium">
            {importedCount} lead{importedCount === 1 ? '' : 's'} imported
          </Text>
          <Text className="text-xs text-green-200/80 mt-1">
            Switch to Insights to preview examples or run another import to add more leads.
          </Text>
        </View>
      )}
    </View>
  );

  const renderApiTab = () => (
    <View className="gap-4">
      <View className="p-4 border border-yellow-500/30 rounded-xl bg-yellow-500/10">
        <Text className="text-xs text-yellow-200 uppercase tracking-[0.2em] mb-2">
          Coming Soon
        </Text>
        <Text className="text-sm text-yellow-100">
          The API workflow is in development. These controls are read-only for now while we wire up live endpoints.
        </Text>
      </View>

      <View className="p-4 border border-white/10 rounded-xl bg-white/5 opacity-60">
        <Text className="text-xs text-gray-400 uppercase tracking-[0.2em] mb-2">
          Endpoint URL
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={{ flex: 1, color: '#FFFFFF', fontSize: 13, fontFamily: 'Instrument Sans, system-ui, sans-serif' }}>
            {endpointUrl}
          </Text>
          <TouchableOpacity
            onPress={() => handleCopy(endpointUrl, 'Endpoint URL')}
            style={{
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 8,
              backgroundColor: 'rgba(255,255,255,0.08)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.14)',
            }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 12, fontFamily: 'Instrument Sans, system-ui, sans-serif' }}>Copy</Text>
          </TouchableOpacity>
        </View>
        <Text className="text-xs text-gray-400 mt-3">
          Send a POST request to this URL to push leads directly into the bucket.
        </Text>
      </View>

      <View className="p-4 border border-white/10 rounded-xl bg-white/5 opacity-60">
        <Text className="text-xs text-gray-400 uppercase tracking-[0.2em] mb-2">
          API Key
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={{ flex: 1, color: '#FFFFFF', fontSize: 13, fontFamily: 'Instrument Sans, system-ui, sans-serif' }}>
            {apiKeyVisible ? apiKey : '••••••••••••••••••'}
          </Text>
          <TouchableOpacity
            onPress={() => setApiKeyVisible(!apiKeyVisible)}
            style={{
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 8,
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.08)',
            }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 12 }}>{apiKeyVisible ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleCopy(apiKey, 'API key')}
            style={{
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 8,
              backgroundColor: 'rgba(255,255,255,0.08)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.14)',
            }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 12 }}>Copy</Text>
          </TouchableOpacity>
        </View>
        <Text className="text-xs text-gray-400 mt-3">
          Use this key as a Bearer token in the Authorization header. Replace with a secure value when wiring up the backend.
        </Text>
      </View>

      <View className="p-4 border border-white/10 rounded-xl bg-white/5">
        <Text className="text-xs text-gray-400 uppercase tracking-[0.2em] mb-2">
          Example Request
        </Text>
        <View className="bg-black/40 border border-white/10 rounded-lg p-3">
          <Text
            style={{
              fontFamily: 'Menlo, Consolas, monospace',
              fontSize: 12,
              lineHeight: 18,
              color: '#E5E7EB',
            }}
          >
            {payloadExample}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 }}>
          <TouchableOpacity
            onPress={() => handleCopy(payloadExample, 'Payload example')}
            style={{
              borderRadius: 12,
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.14)',
              backgroundColor: 'rgba(255,255,255,0.05)',
            }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 13 }}>Copy Payload</Text>
          </TouchableOpacity>
          <Button onPress={handleTestEndpoint} disabled={testStatus === 'loading'}>
            {testStatus === 'loading' ? 'Testing…' : 'Send Test (Mock)'}
          </Button>
        </View>
        {testStatus === 'success' && (
          <Text className="text-xs text-green-300 mt-2">
            Mock request recorded. Replace with real networking code to validate the endpoint.
          </Text>
        )}
      </View>
    </View>
  );

  const renderInsightsTab = () => (
    <View className="gap-4">
      {isLoadingLeads ? (
        <View className="p-4 border border-white/10 rounded-xl bg-white/5">
          <Text className="text-sm text-gray-300">
            Loading insights...
          </Text>
        </View>
      ) : insightSummary.totalRows === 0 ? (
        <View className="p-4 border border-white/10 rounded-xl bg-white/5">
          <Text className="text-sm text-gray-300">
            No leads found for this campaign.
          </Text>
          <Text className="text-xs text-gray-400 mt-2">
            Import leads via CSV or use the API endpoint to populate data.
          </Text>
        </View>
      ) : (
        <>
          <View className="p-4 border border-white/10 rounded-xl bg-white/5">
            <Text className="text-sm text-white font-instrument-medium">
              {dbLeads.length > 0
                ? `${leadCount ?? dbLeads.length} lead${(leadCount ?? dbLeads.length) === 1 ? '' : 's'} in campaign`
                : `${insightSummary.totalRows} lead${insightSummary.totalRows === 1 ? '' : 's'} imported in latest upload`}
            </Text>
            <Text className="text-xs text-gray-400 mt-2">
              Showing field coverage across {dbLeads.length > 0 ? 'all' : 'imported'} records.
            </Text>
          </View>

          <DataTable
            items={leadsForInsights.map((row, i) => ({ ...row, __rowKey: `row-${i}` })) as (Record<string, string> & { __rowKey: string })[]}
            columns={insightSummary.fields.map(
              (f): TableColumn<Record<string, string> & { __rowKey: string }> => {
                const filled = Math.round(insightSummary.totalRows * (f.percentage / 100));
                const empty = insightSummary.totalRows - filled;
                const minFromLabel = Math.ceil(f.field.length * 8);
                const minWidth = Math.min(
                  INSIGHTS_COLUMN_MAX_WIDTH,
                  Math.max(INSIGHTS_COLUMN_MIN_WIDTH, minFromLabel)
                );
                return {
                  key: f.field,
                  label: f.field,
                  flex: 0,
                  minWidth,
                  maxWidth: INSIGHTS_COLUMN_MAX_WIDTH,
                  headerStats: { filled, empty },
                  render: (item) => (
                    <Text className="text-white font-instrument text-sm" numberOfLines={1}>
                      {item[f.field] ?? '—'}
                    </Text>
                  ),
                };
              }
            )}
            itemsPerPage={20}
            emptyMessage="No sample records"
            getItemKey={(item) => item.__rowKey}
          />
        </>
      )}
    </View>
  );

  const renderImportWizardModal = () => {
    if (!isImportWizardOpen) {
      return null;
    }

    const isLastStep = csvStep === csvSteps.length - 1;

    const wizardFooter = (
      <View className="flex-row items-center justify-between">
        <TouchableOpacity
          onPress={goToPreviousCsvStep}
          disabled={csvStep === 0 || isSavingImport}
          style={{
            borderRadius: 12,
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderWidth: 1,
            borderColor: csvStep === 0 || isSavingImport ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.18)',
            opacity: csvStep === 0 || isSavingImport ? 0.5 : 1,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 14, fontFamily: 'Instrument Sans, system-ui, sans-serif' }}>Back</Text>
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity
            onPress={handleWizardReset}
            disabled={!csvColumns.length || isSavingImport}
            style={{
              borderRadius: 12,
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderWidth: 1,
              borderColor: !csvColumns.length || isSavingImport ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.14)',
              opacity: !csvColumns.length || isSavingImport ? 0.5 : 1,
            }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 14, fontFamily: 'Instrument Sans, system-ui, sans-serif' }}>Reset</Text>
          </TouchableOpacity>

          <Button
            onPress={isLastStep ? handleConfirmImport : goToNextCsvStep}
            disabled={isLastStep ? !importSummary || isSavingImport : isNextDisabled}
          >
            {isLastStep ? (isSavingImport ? 'Importing…' : 'Import Leads') : 'Next'}
          </Button>
        </View>
      </View>
    );

    return (
      <BaseModal
        visible={isImportWizardOpen}
        onClose={handleCloseImportWizard}
        title="Import Leads"
        description="Upload a CSV, match your fields, and review before saving leads to this bucket"
        footer={wizardFooter}
        maxWidth="full"
        height={Math.round(windowHeight * 0.9)}
      >
        <View className="gap-6">
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 16 }}>
            {csvSteps.map((stepLabel, index) => {
              const isActive = index === csvStep;
              const isComplete = index < csvStep;
              return (
                <View key={stepLabel} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ alignItems: 'center', minWidth: 88 }}>
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: isActive ? '#F3440D' : isComplete ? 'rgba(243,68,13,0.4)' : 'rgba(255,255,255,0.08)',
                      }}
                    >
                      <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '600' }}>{index + 1}</Text>
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
                      {stepLabel}
                    </Text>
                  </View>
                  {index < csvSteps.length - 1 && (
                    <View style={{ width: 40, height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginHorizontal: 8 }} />
                  )}
                </View>
              );
            })}
          </View>

          {renderCsvStepContent()}
        </View>
      </BaseModal>
    );
  };

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'details':
        return renderDetailsTab();
      case 'csv':
        return renderImportTab();
      case 'api':
        return renderApiTab();
      case 'insights':
        return renderInsightsTab();
      default:
        return null;
    }
  };

  const footer = (
    <View className="flex-row gap-3">
      <View className="flex-1">
        <TouchableOpacity
          onPress={onClose}
          className="border border-[#3A3A3A] rounded-xl px-6 py-3 items-center justify-center"
          style={{
            borderWidth: 1,
            borderColor: '#3A3A3A',
          }}
        >
          <Text className="text-white font-instrument-medium text-base">
            Cancel
          </Text>
        </TouchableOpacity>
      </View>
      <View className="flex-1">
        <Button onPress={handleSave} disabled={!label.trim()}>
          Save
        </Button>
      </View>
    </View>
  );

  return (
    <>
      <BaseModal
        visible={visible}
        onClose={onClose}
        title="Configure Lead Source Node"
        description="Configure CSV imports, API access, and data insights for this lead bucket"
        footer={footer}
        maxWidth="full"
        height={Math.round(windowHeight * 0.9)}
      >
        <View className="gap-6">
          <Tabs
            tabs={[...leadSourceTabs]}
            activeTab={activeTab}
            onTabChange={(id) => setActiveTab(id as TabId)}
            layout="content"
          />

          {renderActiveTab()}
      </View>
    </BaseModal>

      {renderImportWizardModal()}
    </>
  );
}

export { LeadSourceNodeModal };
export default LeadSourceNodeModal;

