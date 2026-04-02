import { useCallback, useState } from 'react';
import { View, ScrollView, Text } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import { Tabs, type Tab } from '@/components/ui/tabs';
import { DedupeQueuePanel } from '@/components/foundry/dedupe/DedupeQueuePanel';
import { ManualCompaniesPanel } from '@/components/foundry/dedupe/ManualCompaniesPanel';
import { ManualEntityOwnersPanel } from '@/components/foundry/dedupe/ManualEntityOwnersPanel';
import { fetchReviewTasks } from '@/lib/foundry/registry-client';
import type { ReviewTaskRow } from '@/lib/foundry/registry-types';

const TABLE_TABS: Tab[] = [
  { id: 'companies', label: 'Companies' },
  { id: 'contacts', label: 'Contacts' },
];

const MODE_TABS: Tab[] = [
  { id: 'queue', label: 'Queue' },
  { id: 'manual', label: 'Manual' },
];

type DedupeTable = 'companies' | 'contacts';
type DedupeMode = 'queue' | 'manual';

export default function FoundryDedupeScreen() {
  const [table, setTable] = useState<DedupeTable>('companies');
  const [mode, setMode] = useState<DedupeMode>('queue');
  const [companyTasks, setCompanyTasks] = useState<ReviewTaskRow[]>([]);
  const [contactTasks, setContactTasks] = useState<ReviewTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCompanies = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const r = await fetchReviewTasks({ status: 'pending', task_type: 'company_dedupe', limit: 100 });
      setCompanyTasks(r.tasks);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setCompanyTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadContacts = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const r = await fetchReviewTasks({ status: 'pending', task_type: 'entity_owner_dedupe', limit: 100 });
      setContactTasks(r.tasks);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setContactTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (mode !== 'queue') return;
      if (table === 'companies') void loadCompanies();
      else void loadContacts();
    }, [mode, table, loadCompanies, loadContacts]),
  );

  const refresh = () => {
    if (table === 'companies') void loadCompanies();
    else void loadContacts();
  };

  const tasks = table === 'companies' ? companyTasks : contactTasks;

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      showsVerticalScrollIndicator={false}
    >
      <Breadcrumb items={[{ label: 'Foundry', href: '/foundry' }, { label: 'Deduplication' }]} />
      <PageHeader
        title="Deduplication"
        subtitle="Queue keeps the review-task workflow. Manual lets you search, filter, and work through the full dedupe tables directly."
      />

      <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-1">Tables</Text>
      <Tabs tabs={TABLE_TABS} activeTab={table} onTabChange={(id) => setTable(id as DedupeTable)} marginBottom={12} />

      <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-1">Modes</Text>
      <Tabs tabs={MODE_TABS} activeTab={mode} onTabChange={(id) => setMode(id as DedupeMode)} marginBottom={12} />

      {mode === 'queue' ? (
        <DedupeQueuePanel
          table={table}
          tasks={tasks}
          loading={loading}
          error={error}
          onRefresh={() => void refresh()}
          onTasksChanged={() => {
            if (table === 'companies') void loadCompanies();
            else void loadContacts();
          }}
        />
      ) : table === 'companies' ? (
        <ManualCompaniesPanel />
      ) : (
        <ManualEntityOwnersPanel />
      )}
    </ScrollView>
  );
}
