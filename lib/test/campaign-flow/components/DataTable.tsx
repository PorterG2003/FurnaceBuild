import { useState, useMemo, ReactNode } from 'react';
import { View, Text, Pressable, TextInput, ScrollView } from 'react-native';
import { ChevronUpIcon, ChevronDownIcon, MagnifyingGlassIcon } from 'react-native-heroicons/outline';

export interface TableColumn<T> {
  key: string;
  label: string;
  minWidth?: number; // Minimum width in pixels
  flex?: number; // Flex value (defaults to 1 if not specified)
  sortable?: boolean;
  sortValue?: (item: T) => string | number; // Function to extract sortable value
  render: (item: T) => ReactNode;
}

interface DataTableProps<T> {
  title: string;
  items: T[];
  columns: TableColumn<T>[];
  searchable?: boolean;
  searchPlaceholder?: string;
  searchFilter?: (item: T, query: string) => boolean;
  itemsPerPage?: number;
  loading?: boolean;
  emptyMessage?: string;
  onRowPress?: (item: T) => void;
  getItemKey: (item: T) => string;
}

type SortDirection = 'asc' | 'desc';

export function DataTable<T>({
  title,
  items,
  columns,
  searchable = false,
  searchPlaceholder = 'Search...',
  searchFilter,
  itemsPerPage = 20,
  loading = false,
  emptyMessage = 'No items found',
  onRowPress,
  getItemKey,
}: DataTableProps<T>) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [currentPage, setCurrentPage] = useState(1);

  // Filter items based on search query
  const filteredItems = useMemo(() => {
    if (!searchable || !searchQuery.trim() || !searchFilter) return items;
    const query = searchQuery.toLowerCase();
    return items.filter((item) => searchFilter(item, query));
  }, [items, searchQuery, searchable, searchFilter]);

  // Sort items
  const sortedItems = useMemo(() => {
    if (!sortColumn) return filteredItems;

    const column = columns.find((col) => col.key === sortColumn);
    if (!column || !column.sortable || !column.sortValue) return filteredItems;

    const sorted = [...filteredItems].sort((a, b) => {
      const aValue = column.sortValue!(a);
      const bValue = column.sortValue!(b);

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [filteredItems, sortColumn, sortDirection, columns]);

  // Paginate items
  const totalPages = Math.ceil(sortedItems.length / itemsPerPage);
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedItems.slice(start, start + itemsPerPage);
  }, [sortedItems, currentPage, itemsPerPage]);

  const handleSort = (columnKey: string) => {
    const column = columns.find((col) => col.key === columnKey);
    if (!column || !column.sortable) return;

    if (sortColumn === columnKey) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(columnKey);
      setSortDirection('asc');
    }
    setCurrentPage(1);
  };

  const SortButton = ({ columnKey, label }: { columnKey: string; label: string }) => {
    const column = columns.find((col) => col.key === columnKey);
    if (!column || !column.sortable) {
      return (
        <Text className="text-gray-400 font-instrument-semibold text-xs uppercase">
          {label}
        </Text>
      );
    }

    const isActive = sortColumn === columnKey;
    return (
      <Pressable
        onPress={() => handleSort(columnKey)}
        className="flex-row items-center gap-1 px-3 py-2 active:opacity-70"
      >
        <Text
          className={`text-xs font-instrument-semibold ${
            isActive ? 'text-white' : 'text-gray-400'
          }`}
        >
          {label}
        </Text>
        {isActive && (
          <>
            {sortDirection === 'asc' ? (
              <ChevronUpIcon size={14} color="#fff" />
            ) : (
              <ChevronDownIcon size={14} color="#fff" />
            )}
          </>
        )}
      </Pressable>
    );
  };

  if (loading) {
    return (
      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6">
        <Text className="text-gray-400 font-instrument text-sm">Loading...</Text>
      </View>
    );
  }

  return (
    <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6">
      <View className="flex-row items-center justify-between mb-4">
        <Text className="text-lg font-instrument-semibold text-white">{title}</Text>
        <Text className="text-gray-400 font-instrument text-sm">
          {sortedItems.length} {sortedItems.length !== 1 ? 'items' : 'item'}
          {searchQuery && ` (filtered from ${items.length} total)`}
        </Text>
      </View>

      {/* Search */}
      {searchable && (
        <View className="mb-4">
          <View className="flex-row items-center bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2">
            <MagnifyingGlassIcon size={18} color="#6b7280" />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={searchPlaceholder}
              placeholderTextColor="#6b7280"
              className="flex-1 ml-2 text-white font-instrument text-sm"
            />
          </View>
        </View>
      )}

      {/* Table */}
      <View>
        {/* Table Header */}
        <View className="flex-row border-b border-[#2A2A2A] pb-3 mb-4">
          {columns.map((column, index) => (
            <View
              key={column.key}
              style={{
                minWidth: column.minWidth,
                flex: column.flex !== undefined ? column.flex : 1,
                paddingRight: index < columns.length - 1 ? 16 : 0,
              }}
            >
              <SortButton columnKey={column.key} label={column.label} />
            </View>
          ))}
        </View>

        {/* Table Rows */}
        {paginatedItems.length === 0 ? (
          <View className="py-12 items-center">
            <Text className="text-gray-500 font-instrument text-sm">{emptyMessage}</Text>
          </View>
        ) : (
          <View className="gap-3">
            {paginatedItems.map((item) => {
              const RowContent = (
                <View className="flex-row items-center bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-4 py-3">
                  {columns.map((column, index) => (
                    <View
                      key={column.key}
                      style={{
                        minWidth: column.minWidth,
                        flex: column.flex !== undefined ? column.flex : 1,
                        paddingRight: index < columns.length - 1 ? 16 : 0,
                      }}
                    >
                      {column.render(item)}
                    </View>
                  ))}
                </View>
              );

              if (onRowPress) {
                return (
                  <Pressable
                    key={getItemKey(item)}
                    onPress={() => onRowPress(item)}
                    className="active:opacity-80 active:border-[#3A3A3A]"
                  >
                    {RowContent}
                  </Pressable>
                );
              }

              return <View key={getItemKey(item)}>{RowContent}</View>;
            })}
          </View>
        )}
      </View>

      {/* Pagination */}
      {totalPages > 0 && (
        <View className="flex-row items-center justify-between mt-6 pt-4 border-t border-[#2A2A2A]">
          <Pressable
            onPress={() => setCurrentPage(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className={`px-4 py-2 rounded-lg border ${
              currentPage === 1
                ? 'border-[#2A2A2A] opacity-50'
                : 'border-[#3A3A3A] active:opacity-70'
            }`}
            style={{ backgroundColor: '#1A1A1A' }}
          >
            <Text
              className={`text-sm font-instrument-semibold ${
                currentPage === 1 ? 'text-gray-500' : 'text-white'
              }`}
            >
              Previous
            </Text>
          </Pressable>

          <Text className="text-gray-400 font-instrument text-sm">
            Page {currentPage} of {totalPages}
          </Text>

          <Pressable
            onPress={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            className={`px-4 py-2 rounded-lg border ${
              currentPage === totalPages
                ? 'border-[#2A2A2A] opacity-50'
                : 'border-[#3A3A3A] active:opacity-70'
            }`}
            style={{ backgroundColor: '#1A1A1A' }}
          >
            <Text
              className={`text-sm font-instrument-semibold ${
                currentPage === totalPages ? 'text-gray-500' : 'text-white'
              }`}
            >
              Next
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

