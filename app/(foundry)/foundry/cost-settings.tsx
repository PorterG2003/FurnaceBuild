import { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, Text, TextInput, ActivityIndicator, Alert, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/Card';
import { fetchCostRateCardsList, postCostRateCard } from '@/lib/foundry/registry-client';
import type { CostRateCardRow } from '@/lib/foundry/registry-types';

export default function FoundryCostSettingsScreen() {
  const router = useRouter();
  const [rates, setRates] = useState<CostRateCardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newKind, setNewKind] = useState<'acquisition' | 'enrichment'>('acquisition');
  const [newProvider, setNewProvider] = useState('');
  const [newProduct, setNewProduct] = useState('');
  const [newCents, setNewCents] = useState('');
  const [newUsageUnit, setNewUsageUnit] = useState('row');
  const [newUnitQuantity, setNewUnitQuantity] = useState('1');
  const [newNotes, setNewNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchCostRateCardsList();
      setRates(res.rates);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setRates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, flexGrow: 1, paddingBottom: 48 }}
      showsVerticalScrollIndicator={false}
    >
      <View className="mb-4">
        <Breadcrumb items={[{ label: 'Foundry', href: '/foundry' }, { label: 'Cost settings' }]} />
      </View>
      <PageHeader
        title="Cost rate cards"
        subtitle="Default USD-cent prices per provider/product. Import and enrichment UIs pre-fill from these rows."
      />
      <Pressable onPress={() => router.push('/foundry')} className="mb-4 self-start">
        <Text className="text-brand-orange font-instrument text-sm underline">Back to Foundry</Text>
      </Pressable>

      {error ? <Text className="text-red-400 mb-3 font-instrument text-sm">{error}</Text> : null}

      {loading ? (
        <ActivityIndicator />
      ) : (
        <Card variant="card" className="mb-6">
          <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-3">Active rates</Text>
          {rates.length === 0 ? (
            <Text className="text-gray-400 font-instrument text-sm">No active rate cards.</Text>
          ) : (
            <View className="gap-3">
              {rates.map((r) => (
                <View key={r.id} className="border border-[#2A2A2A] rounded-lg px-3 py-2">
                  <Text className="text-white font-instrument text-sm">
                    {r.cost_kind} · {r.provider} · {r.product}
                  </Text>
                  <Text className="text-gray-400 font-instrument text-xs mt-1">
                    {r.unit_price_cents} {r.currency} / {r.unit_quantity} {r.usage_unit}
                  </Text>
                  {r.notes ? (
                    <Text className="text-gray-500 font-instrument text-xs mt-1">{r.notes}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          )}
          <Button variant="secondary" size="sm" className="mt-4 self-start" onPress={() => void load()}>
            Refresh
          </Button>
        </Card>
      )}

      <Card variant="card">
        <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-3">Add rate</Text>
        <Text className="text-gray-400 font-instrument text-xs mb-3">
          Creates a new row. Check &quot;Retire previous&quot; to end-date the current active row for the same triple
          (recommended when changing price).
        </Text>
        <View className="gap-3">
          <View className="flex-row gap-2 flex-wrap">
            <Button
              variant={newKind === 'acquisition' ? 'default' : 'secondary'}
              size="sm"
              onPress={() => setNewKind('acquisition')}
            >
              acquisition
            </Button>
            <Button
              variant={newKind === 'enrichment' ? 'default' : 'secondary'}
              size="sm"
              onPress={() => setNewKind('enrichment')}
            >
              enrichment
            </Button>
          </View>
          <Text className="text-gray-500 font-instrument text-xs">Provider (e.g. google_maps, skipsherpa)</Text>
          <TextInput
            value={newProvider}
            onChangeText={setNewProvider}
            placeholder="google_maps"
            placeholderTextColor="#6b7280"
            className="border border-[#3A3A3A] rounded-lg px-3 py-2 text-white font-instrument text-sm bg-[#121212]"
          />
          <Text className="text-gray-500 font-instrument text-xs">Product (e.g. import_row, person_lookup)</Text>
          <TextInput
            value={newProduct}
            onChangeText={setNewProduct}
            placeholder="import_row"
            placeholderTextColor="#6b7280"
            className="border border-[#3A3A3A] rounded-lg px-3 py-2 text-white font-instrument text-sm bg-[#121212]"
          />
          <Text className="text-gray-500 font-instrument text-xs">
            Unit price (cents per hit or per row, per product)
          </Text>
          <TextInput
            value={newCents}
            onChangeText={setNewCents}
            placeholder="2"
            placeholderTextColor="#6b7280"
            keyboardType="number-pad"
            className="border border-[#3A3A3A] rounded-lg px-3 py-2 text-white font-instrument text-sm bg-[#121212]"
          />
          <Text className="text-gray-500 font-instrument text-xs">Usage unit (e.g. row, lookup, ms)</Text>
          <TextInput
            value={newUsageUnit}
            onChangeText={setNewUsageUnit}
            placeholder="row"
            placeholderTextColor="#6b7280"
            className="border border-[#3A3A3A] rounded-lg px-3 py-2 text-white font-instrument text-sm bg-[#121212]"
          />
          <Text className="text-gray-500 font-instrument text-xs">
            Unit quantity covered by the price above (e.g. 1 row, 3600000 ms)
          </Text>
          <TextInput
            value={newUnitQuantity}
            onChangeText={setNewUnitQuantity}
            placeholder="1"
            placeholderTextColor="#6b7280"
            keyboardType="number-pad"
            className="border border-[#3A3A3A] rounded-lg px-3 py-2 text-white font-instrument text-sm bg-[#121212]"
          />
          <Text className="text-gray-500 font-instrument text-xs">Notes (optional)</Text>
          <TextInput
            value={newNotes}
            onChangeText={setNewNotes}
            placeholder="Contract ref"
            placeholderTextColor="#6b7280"
            className="border border-[#3A3A3A] rounded-lg px-3 py-2 text-white font-instrument text-sm bg-[#121212]"
          />
          <Button
            variant="default"
            disabled={busy || !newProvider.trim() || !newProduct.trim()}
            onPress={async () => {
              const n = Number.parseInt(newCents.trim(), 10);
              const q = Number.parseInt(newUnitQuantity.trim(), 10);
              if (!Number.isFinite(n) || n < 0) {
                Alert.alert('Invalid price', 'Enter a non-negative integer cents value.');
                return;
              }
              if (!newUsageUnit.trim() || !Number.isFinite(q) || q <= 0) {
                Alert.alert('Invalid unit', 'Enter a usage unit and a positive integer unit quantity.');
                return;
              }
              setBusy(true);
              try {
                await postCostRateCard({
                  cost_kind: newKind,
                  provider: newProvider.trim(),
                  product: newProduct.trim(),
                  unit_price_cents: n,
                  usage_unit: newUsageUnit.trim(),
                  unit_quantity: q,
                  notes: newNotes.trim() || undefined,
                  retire_previous: true,
                });
                setNewProvider('');
                setNewProduct('');
                setNewCents('');
                setNewUsageUnit('row');
                setNewUnitQuantity('1');
                setNewNotes('');
                await load();
                Alert.alert('Saved', 'New rate card created.');
              } catch (e) {
                Alert.alert('Error', e instanceof Error ? e.message : 'Failed');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Saving…' : 'Create rate'}
          </Button>
        </View>
      </Card>
    </ScrollView>
  );
}
