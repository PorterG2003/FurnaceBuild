import { useCallback, useState } from 'react';
import { View, ScrollView, Text } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Tabs, type Tab } from '@/components/ui/tabs';
import { DedupeTaskCard } from '@/components/foundry/dedupe/DedupeTaskCard';
import { EntityOwnerDedupeTaskCard } from '@/components/foundry/dedupe/EntityOwnerDedupeTaskCard';
import { fetchReviewTasks } from '@/lib/foundry/registry-client';
import type { ReviewTaskRow } from '@/lib/foundry/registry-types';

const DEDUPE_TABS: Tab[] = [
  { id: 'companies', label: 'Companies' },
  { id: 'contacts', label: 'Contacts' },
];

type DedupeTab = 'companies' | 'contacts';

export default function FoundryDedupeScreen() {
  const [tab, setTab] = useState<DedupeTab>('companies');
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
      if (tab === 'companies') void loadCompanies();
      else void loadContacts();
    }, [tab, loadCompanies, loadContacts]),
  );

  const refresh = () => {
    if (tab === 'companies') void loadCompanies();
    else void loadContacts();
  };

  const tasks = tab === 'companies' ? companyTasks : contactTasks;

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      showsVerticalScrollIndicator={false}
    >
      <Breadcrumb items={[{ label: 'Foundry', href: '/foundry' }, { label: 'Deduplication' }]} />
      <PageHeader
        title="Deduplication"
        subtitle="Companies: merge duplicate registry companies. Contacts: merge duplicate owners from state registry data. Each card is one cluster from the review queue."
      />

      <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-1">Mode</Text>
      <Tabs tabs={DEDUPE_TABS} activeTab={tab} onTabChange={(id) => setTab(id as DedupeTab)} marginBottom={12} />

      {error ? <Text className="text-red-400 mb-3 font-instrument text-sm">{error}</Text> : null}

      <View className="flex-row flex-wrap gap-2 items-center mb-4">
        <Button variant="secondary" size="sm" onPress={() => void refresh()} disabled={loading}>
          Refresh
        </Button>
        <Text className="text-gray-500 font-instrument text-xs">
          {loading ? 'Loading…' : `${tasks.length} pending task${tasks.length === 1 ? '' : 's'}`}
        </Text>
      </View>

      {tab === 'companies'
        ? companyTasks.map((t) => (
            <DedupeTaskCard key={t.id} task={t} onTasksChanged={() => void loadCompanies()} />
          ))
        : contactTasks.map((t) => (
            <EntityOwnerDedupeTaskCard key={t.id} task={t} onTasksChanged={() => void loadContacts()} />
          ))}

      {!loading && tasks.length === 0 && !error ? (
        <Text className="text-gray-500 font-instrument text-sm leading-5">
          {tab === 'companies' ? (
            <>
              No pending company dedupe tasks. Tasks are created when two or more companies share the same normalized
              name key (for example after creating a new company from a source row).
            </>
          ) : (
            <>
              No pending contact dedupe tasks. Tasks are created when two or more registry owners share the same
              normalized name key on the same state entity (for example after Utah or Florida registry persist).
            </>
          )}
        </Text>
      ) : null}
    </ScrollView>
  );
}
