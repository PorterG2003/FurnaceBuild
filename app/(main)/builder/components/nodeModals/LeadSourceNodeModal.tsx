import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Platform, Alert } from 'react-native';
import { BaseModal } from '@/components/ui/BaseModal';
import { Button } from '@/components/ui/button';
import { createLeads, generateGlobalLeadId } from '@/lib/supabase/services/leads';

interface LeadSourceNodeModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (data: {
    label?: string;
    source?: string;
  }) => void;
  initialData?: {
    label?: string;
    source?: string;
    campaignId?: string;
    bucketId?: string;
  };
}

// Simple CSV parser (handles basic CSV format)
function parseCSV(csvText: string): Record<string, string>[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    if (values.length === 0 || values.every(v => !v)) continue; // Skip empty rows

    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header.toLowerCase()] = values[index] || '';
    });
    rows.push(row);
  }

  return rows;
}

function LeadSourceNodeModal({
  visible,
  onClose,
  onSave,
  initialData,
}: LeadSourceNodeModalProps) {
  const [label, setLabel] = useState(initialData?.label || 'Lead Bucket');
  const [source, setSource] = useState(initialData?.source || '');
  const [isImporting, setIsImporting] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  const handleSave = () => {
    onSave({ label, source });
    onClose();
  };

  const handleCSVImport = async () => {
    if (!initialData?.campaignId || !initialData?.bucketId) {
      Alert.alert('Error', 'Campaign ID and Bucket ID are required for importing leads');
      return;
    }

    try {
      if (Platform.OS !== 'web') {
        // For mobile, use document picker
        const result = await pick({
          type: ['text/csv', 'text/comma-separated-values'],
        });

        if (result && result.length > 0) {
          const file = result[0];
          // For React Native, you'd need to read the file differently
          // This is a simplified version - you may need expo-file-system or similar
          Alert.alert('Info', 'CSV import on mobile requires additional setup');
        }
      } else {
        // For web, create file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv';
        input.onchange = async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file) return;

          setIsImporting(true);
          try {
            const text = await file.text();
            const rows = parseCSV(text);

            if (rows.length === 0) {
              Alert.alert('Error', 'No valid data found in CSV file');
              setIsImporting(false);
              return;
            }

            // Map CSV rows to LeadInsert format
            const leads = await Promise.all(
              rows.map(async (row) => {
                const email = row.email || row['email address'] || null;
                return {
                  campaign_id: initialData.campaignId!,
                  bucket_id: initialData.bucketId!,
                  email,
                  name: row.name || row['full name'] || null,
                  phone: row.phone || row['phone number'] || null,
                  source: source || initialData.source || 'CSV Import',
                  custom_lead_data: Object.fromEntries(
                    Object.entries(row).filter(([key]) => 
                      !['email', 'email address', 'name', 'full name', 'phone', 'phone number'].includes(key.toLowerCase())
                    )
                  ),
                  global_lead_id: email ? await generateGlobalLeadId(email) : null,
                  status: 'new' as const,
                };
              })
            );

            await createLeads(leads);
            setImportedCount(leads.length);
            Alert.alert('Success', `Successfully imported ${leads.length} leads`);
          } catch (error: any) {
            Alert.alert('Error', error.message || 'Failed to import CSV');
          } finally {
            setIsImporting(false);
          }
        };
        input.click();
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to select file');
      setIsImporting(false);
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
        <Button onPress={handleSave}>
          Save
        </Button>
      </View>
    </View>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Configure Lead Source Node"
      description="Configure the lead source trigger"
      footer={footer}
    >
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

        <View>
          <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
            Source
          </Text>
          <TextInput
            value={source}
            onChangeText={setSource}
            placeholder="e.g., Website, Landing Page, Referral"
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

        {/* CSV Import Section */}
        <View className="mt-4 pt-4 border-t border-[#2A2A2A]">
          <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
            Import Leads from CSV
          </Text>
          <Text className="text-xs text-gray-400 mb-4">
            CSV should have columns: email, name, phone (optional). Additional columns will be stored in custom_lead_data.
          </Text>
          
          {importedCount !== null && (
            <View className="mb-3 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
              <Text className="text-green-400 text-sm font-instrument-medium">
                ✓ Successfully imported {importedCount} leads
              </Text>
            </View>
          )}

          <Button
            onPress={handleCSVImport}
            disabled={isImporting || !initialData?.campaignId || !initialData?.bucketId}
            style={{
              opacity: isImporting || !initialData?.campaignId || !initialData?.bucketId ? 0.5 : 1,
            }}
          >
            {isImporting ? 'Importing...' : 'Import CSV'}
          </Button>
        </View>
      </View>
    </BaseModal>
  );
}

export { LeadSourceNodeModal };
export default LeadSourceNodeModal;

