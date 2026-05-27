export type LeadsWorkbenchActionItem = {
  key: string;
  label: string;
  onPress: () => void;
  tone?: 'default' | 'destructive';
  disabled?: boolean;
};

export type LeadsWorkbenchActionGroupId = 'campaigns' | 'lists' | 'enrollment';

export type LeadsWorkbenchActionGroup = {
  id: LeadsWorkbenchActionGroupId;
  title: string;
  items: LeadsWorkbenchActionItem[];
};

type SelectionHandlers = {
  onAddToCampaign: () => void;
  onAddToList: () => void;
  onRemoveFromList: () => void;
  onPause: () => void;
  onResume: () => void;
  onRemoveFromCampaigns: () => void;
};

export type LeadsWorkbenchActionContext =
  | ({
      kind: 'explorerSelection';
      selectedCount: number;
      onCreateListFromSelection: () => void;
    } & SelectionHandlers)
  | {
      kind: 'explorerView';
      matchingCount: number;
      onSaveViewAsList: () => void;
      onAddViewToList: () => void;
      onRemoveViewFromList: () => void;
    }
  | ({
      kind: 'listSelection';
      selectedCount: number;
    } & SelectionHandlers)
  | {
      kind: 'listView';
      leadCount: number;
      filteredCount?: number;
      hasActiveFilters?: boolean;
      onAddAllToCampaign: () => void;
      onRemoveAllFromList: () => void;
      onRemoveFilteredFromList?: () => void;
    };

function selectionGroups(handlers: SelectionHandlers, includeCreateList: boolean): LeadsWorkbenchActionGroup[] {
  const listsItems: LeadsWorkbenchActionItem[] = [
    {
      key: 'add-to-list',
      label: 'Add to list',
      onPress: handlers.onAddToList,
    },
    {
      key: 'remove-from-list',
      label: 'Remove from list',
      onPress: handlers.onRemoveFromList,
      tone: 'destructive',
    },
  ];

  if (includeCreateList) {
    listsItems.push({
      key: 'create-list-from-selection',
      label: 'Create list from selection',
      onPress: handlers.onAddToList,
    });
  }

  return [
    {
      id: 'campaigns',
      title: 'Campaigns',
      items: [
        {
          key: 'add-to-campaign',
          label: 'Add to campaign',
          onPress: handlers.onAddToCampaign,
        },
        {
          key: 'remove-from-campaigns',
          label: 'Remove from campaigns',
          onPress: handlers.onRemoveFromCampaigns,
          tone: 'destructive',
        },
      ],
    },
    {
      id: 'lists',
      title: 'Lists',
      items: listsItems,
    },
    {
      id: 'enrollment',
      title: 'Enrollment',
      items: [
        {
          key: 'pause',
          label: 'Pause',
          onPress: handlers.onPause,
        },
        {
          key: 'resume',
          label: 'Resume',
          onPress: handlers.onResume,
        },
      ],
    },
  ];
}

export function buildLeadsWorkbenchActionGroups(
  ctx: LeadsWorkbenchActionContext,
): LeadsWorkbenchActionGroup[] {
  switch (ctx.kind) {
    case 'explorerSelection':
      return selectionGroups(
        {
          ...ctx,
          onAddToList: ctx.onAddToList,
        },
        true,
      ).map((group) => {
        if (group.id !== 'lists') return group;
        return {
          ...group,
          items: group.items.map((item) =>
            item.key === 'create-list-from-selection'
              ? { ...item, onPress: ctx.onCreateListFromSelection }
              : item,
          ),
        };
      });
    case 'listSelection':
      return selectionGroups(ctx, false);
    case 'explorerView':
      return [
        {
          id: 'lists',
          title: 'Lists',
          items: [
            {
              key: 'save-view-as-list',
              label: 'Save view as list',
              onPress: ctx.onSaveViewAsList,
            },
            {
              key: 'add-view-to-list',
              label: 'Add view to list',
              onPress: ctx.onAddViewToList,
            },
            {
              key: 'remove-view-from-list',
              label: 'Remove view from list',
              onPress: ctx.onRemoveViewFromList,
              tone: 'destructive',
            },
          ],
        },
      ];
    case 'listView': {
      const showFilteredRemove =
        ctx.hasActiveFilters &&
        ctx.filteredCount !== undefined &&
        ctx.filteredCount > 0 &&
        ctx.filteredCount < ctx.leadCount;

      const listRemoveItem: LeadsWorkbenchActionItem = showFilteredRemove
        ? {
            key: 'remove-filtered-from-list',
            label: `Remove filtered (${ctx.filteredCount!.toLocaleString()})`,
            onPress: ctx.onRemoveFilteredFromList ?? ctx.onRemoveAllFromList,
            tone: 'destructive',
          }
        : {
            key: 'remove-all-from-list',
            label: 'Remove all from list',
            onPress: ctx.onRemoveAllFromList,
            tone: 'destructive',
          };

      return [
        {
          id: 'campaigns',
          title: 'Campaigns',
          items: [
            {
              key: 'add-all-to-campaign',
              label: 'Add all to campaign',
              onPress: ctx.onAddAllToCampaign,
            },
          ],
        },
        {
          id: 'lists',
          title: 'Lists',
          items: [listRemoveItem],
        },
      ];
    }
  }
}

export function buildLeadsWorkbenchScopeLabel(ctx: LeadsWorkbenchActionContext): string | null {
  switch (ctx.kind) {
    case 'explorerSelection':
    case 'listSelection':
      return ctx.selectedCount > 0 ? `${ctx.selectedCount} selected` : null;
    case 'explorerView':
      return ctx.matchingCount > 0
        ? `${ctx.matchingCount.toLocaleString()} lead${ctx.matchingCount === 1 ? '' : 's'} in this view`
        : null;
    case 'listView': {
      if (ctx.leadCount === 0) return null;
      const showFilteredRemove =
        ctx.hasActiveFilters &&
        ctx.filteredCount !== undefined &&
        ctx.filteredCount > 0 &&
        ctx.filteredCount < ctx.leadCount;
      if (showFilteredRemove) {
        return `${ctx.filteredCount!.toLocaleString()} of ${ctx.leadCount.toLocaleString()} lead${ctx.leadCount === 1 ? '' : 's'} in filtered view`;
      }
      return `${ctx.leadCount.toLocaleString()} lead${ctx.leadCount === 1 ? '' : 's'} in this list`;
    }
  }
}
