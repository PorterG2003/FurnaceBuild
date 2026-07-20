import { useEffect, useCallback, useState, useMemo, useRef } from 'react';
import { View, Platform, Text } from 'react-native';
import { ConfirmModal } from '@/components/ui/modals';
import { AccessIssueDialog } from '@/components/ui/modals/AccessIssueDialog';
import { useToast } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Breadcrumb, PageLayout } from '@/components/ui/layout';
import { NavBar } from '@/components/ui/layout/NavBar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getCampaignById, updateCampaignFlowData } from '@/lib/supabase/services/campaigns';
import type { Campaign } from '@/lib/supabase/types';
import { debounce } from '@/lib/utils/debounce';
import { isSmartleadCampaign } from '@/lib/campaigns/utils';
import { SmartleadRestrictedModal } from '@/components/campaigns/SmartleadRestrictedModal';
import { CampaignStatusMenu } from '@/components/campaigns';
import { useCampaignStatusActions } from '@/lib/campaigns/useCampaignStatusActions';
import {
  classifyFlowChange,
  computeFlowRevision,
  edgesToRemoveForDeletedNodeIds,
  FlowEditForbiddenError,
  FlowPrepareValidationError,
  FlowRevisionConflictError,
  FLOW_MODAL_DELETE_BODY_DRAFT,
  FLOW_MODAL_DELETE_BODY_PAUSED,
  FLOW_MODAL_DELETE_EDGE_BODY,
  FLOW_MODAL_DELETE_EDGE_TITLE,
  FLOW_MODAL_PAUSE_BODY,
  FLOW_MODAL_PAUSE_CONFIRM,
  FLOW_MODAL_PAUSE_TITLE,
  FLOW_MODAL_STOPPED_BODY,
  FLOW_MODAL_STOPPED_CONFIRM,
  FLOW_MODAL_STOPPED_TITLE,
  FLOW_TOAST_STOPPED,
  flowNeedsOrphanEdgeHeal,
  formatFlowAppendReactivatedToast,
  formatFlowModalDeleteTitle,
  isFlowReadOnly,
  isStructuralEditAllowed,
  normalizeFlowData,
  prepareFlowSave,
  stableSerializeFlow,
  type CampaignFlowData,
} from '@/lib/campaigns/flow';
import { FlowConflictModal } from './components/FlowConflictModal';
import { FlowStructureLockedBadge } from './components/FlowStructureLockedBadge';
import { nodeTypes } from './nodes/nodeTypes';
import { edgeTypes } from './edges/edgeTypes';
import { NodeSidebar } from './components/NodeSidebar';
import { nodeModalRegistry } from './components/nodeModals';
import { 
  createEmailNode,
  createLeadSourceNode,
  createWaitTimeNode,
  createAICategorizerNode,
  createDataSenderNode,
} from './nodes/factories';
import {
  FlowCanvas,
  isReactFlowWebAvailable,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
} from '@/lib/flow';

function sanitizeFlowData(
  nodes: Record<string, any>[] | null | undefined,
  edges: Record<string, any>[] | null | undefined,
) {
  return normalizeFlowData({
    nodes: Array.isArray(nodes) ? nodes : [],
    edges: Array.isArray(edges) ? edges : [],
  });
}

/** Label for the flow editor / builder page in breadcrumbs and UI. Change here to rename globally. */
export const FLOW_EDITOR_PAGE_LABEL = 'Flow editor';

function getLeadSourceFieldKeysFromFlow(): {
  customFieldKeys: string[];
  mappedStandardFieldKeys: string[] | undefined;
} {
  const nodes =
    typeof window !== 'undefined' && (window as any).__reactFlowGetNodes
      ? (window as any).__reactFlowGetNodes()
      : [];
  const leadSourceNodes = (nodes as any[]).filter((n: any) => n.type === 'leadSource');
  const customFieldKeys = Array.from(
    new Set(leadSourceNodes.flatMap((n: any) => n.data?.customFieldKeys ?? []))
  );
  const mappedStandardFieldKeys = Array.from(
    new Set(leadSourceNodes.flatMap((n: any) => n.data?.mappedStandardFieldKeys ?? []))
  );
  return {
    customFieldKeys,
    mappedStandardFieldKeys:
      mappedStandardFieldKeys.length > 0 ? mappedStandardFieldKeys : undefined,
  };
}

// Factory map for creating nodes
const nodeFactories: Record<string, (position: { x: number; y: number }) => any> = {
  email: createEmailNode,
  leadSource: createLeadSourceNode,
  waitTime: createWaitTimeNode,
  aiCategorizer: createAICategorizerNode,
  dataSender: createDataSenderNode,
};

const EMPTY_INITIAL_NODES: any[] = [];
const EMPTY_INITIAL_EDGES: any[] = [];

interface FlowEditorProps {
  onEditNode: (nodeId: string, nodeType: string) => void;
  initialNodes?: any[];
  initialEdges?: any[];
  onFlowChange?: (nodes: any[], edges: any[]) => void;
  campaignStatus?: Campaign['status'] | null;
  onStructuralBlocked?: () => void;
  onStoppedInteraction?: () => void;
}

function FlowEditor({
  onEditNode,
  initialNodes = EMPTY_INITIAL_NODES,
  initialEdges = EMPTY_INITIAL_EDGES,
  onFlowChange,
  campaignStatus,
  onStructuralBlocked,
  onStoppedInteraction,
}: FlowEditorProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState!(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState!(initialEdges);
  const structuralAllowed = isStructuralEditAllowed(campaignStatus);
  const flowReadOnly = isFlowReadOnly(campaignStatus);
  const isRunning = campaignStatus === 'running';
  const isPaused = campaignStatus === 'paused';
  
  // Track if initial load is complete to avoid saving during initialization
  const isInitialLoadRef = useRef(true);
  const hasInitializedRef = useRef(false);
  
  // Load initial data when props change (only once)
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (!hasInitializedRef.current && (initialNodes.length > 0 || initialEdges.length > 0)) {
      setNodes(initialNodes);
      setEdges(initialEdges);
      hasInitializedRef.current = true;
      isInitialLoadRef.current = true;
      // Reset flag after a brief delay to allow React Flow to initialize
      timeoutId = setTimeout(() => {
        isInitialLoadRef.current = false;
      }, 500);
    } else if (!hasInitializedRef.current) {
      // Even if empty, mark as initialized
      hasInitializedRef.current = true;
      timeoutId = setTimeout(() => {
        isInitialLoadRef.current = false;
      }, 500);
    }
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [initialNodes, initialEdges, setNodes, setEdges]);
  
  // Notify parent of changes (for saving). Stopped campaigns are read-only — skip
  // so metadata sync effects (readOnly/canDelete flags) don't trigger revert loops.
  useEffect(() => {
    if (!isInitialLoadRef.current && onFlowChange && !flowReadOnly) {
      onFlowChange(nodes, edges);
    }
  }, [nodes, edges, onFlowChange, flowReadOnly]);

  // Ensure Lead Bucket node exists (only one per campaign) - run once on mount
  useEffect(() => {
    // Check if Lead Bucket already exists
    const hasLeadBucket = nodes.some((node: any) => node.type === 'leadSource');
    
    if (!hasLeadBucket) {
      // Create Lead Bucket node at a fixed position (top-left area)
      const leadBucketNode = createLeadSourceNode(
        { x: 100, y: 100 },
        { bucketId: 'lead-bucket-required' } // Use a fixed ID so it's always the same
      );
      setNodes((nds: any) => {
        // Double-check it doesn't exist before adding
        if (nds.some((n: any) => n.type === 'leadSource')) {
          return nds;
        }
        return [...nds, leadBucketNode];
      });
    }
  }, [nodes, setNodes]);

  // Pending delete confirmation state
  const [pendingDelete, setPendingDelete] = useState<{
    removeChanges: any[];
    labels: string[];
    deleteMode: 'draft' | 'paused';
  } | null>(null);
  const [pendingEdgeDelete, setPendingEdgeDelete] = useState<{ edgeId: string } | null>(null);

  useEffect(() => {
    setEdges((currentEdges: any[]) => {
      const nextReadOnly = flowReadOnly;
      const nextStructuralBlocked = isRunning;
      const needsUpdate = currentEdges.some(
        (edge: any) =>
          edge.data?.readOnly !== nextReadOnly ||
          edge.data?.structuralBlocked !== nextStructuralBlocked,
      );
      if (!needsUpdate) return currentEdges;
      return currentEdges.map((edge: any) => ({
        ...edge,
        data: {
          ...edge.data,
          readOnly: nextReadOnly,
          structuralBlocked: nextStructuralBlocked,
        },
      }));
    });
  }, [flowReadOnly, isRunning, setEdges]);

  useEffect(() => {
    const canDelete = !flowReadOnly;
    setNodes((currentNodes: any[]) =>
      currentNodes.map((node: any) => {
        const nextCanDelete = canDelete;
        const nextStructuralBlocked = isRunning;
        if (
          node.data?.canDelete === nextCanDelete &&
          node.data?.structuralBlocked === nextStructuralBlocked
        ) {
          return node;
        }
        return {
          ...node,
          data: { ...node.data, canDelete: nextCanDelete, structuralBlocked: nextStructuralBlocked },
        };
      }),
    );
  }, [flowReadOnly, isRunning, setNodes]);

  const applyPendingDelete = useCallback(() => {
    if (!pendingDelete) return;
    const deletedNodeIds = pendingDelete.removeChanges
      .filter((change: any) => change?.type === 'remove' && typeof change.id === 'string')
      .map((change: any) => change.id as string);
    const edgeIdsToRemove = edgesToRemoveForDeletedNodeIds(edges, deletedNodeIds);
    if (edgeIdsToRemove.length > 0) {
      onEdgesChange(edgeIdsToRemove.map((id) => ({ type: 'remove', id })));
    }
    onNodesChange(pendingDelete.removeChanges);
    setPendingDelete(null);
  }, [edges, onEdgesChange, onNodesChange, pendingDelete]);

  const applyPendingEdgeDelete = useCallback(() => {
    if (!pendingEdgeDelete) return;
    onEdgesChange([{ type: 'remove', id: pendingEdgeDelete.edgeId }]);
    setPendingEdgeDelete(null);
  }, [onEdgesChange, pendingEdgeDelete]);

  const cancelPendingDelete = useCallback(() => {
    setPendingDelete(null);
  }, []);

  // Node deletion is only allowed via the action rail + confirm modal.
  // Ignore any remove changes (e.g. from keyboard) — deleteKeyCode is disabled on ReactFlow.
  const handleNodesChange = useCallback((changes: any[]) => {
    const filteredChanges = changes.filter((change: any) => change.type !== 'remove');
    if (filteredChanges.length > 0) {
      onNodesChange(filteredChanges);
    }
  }, [onNodesChange]);

  // Edge deletion is only allowed via the edge delete button.
  const handleEdgesChange = useCallback((changes: any[]) => {
    const filteredChanges = changes.filter((change: any) => change.type !== 'remove');
    if (filteredChanges.length > 0) {
      onEdgesChange(filteredChanges);
    }
  }, [onEdgesChange]);

  const onConnect = useCallback(
    (params: any) => {
      if (flowReadOnly) {
        onStoppedInteraction?.();
        return;
      }
      if (isRunning) {
        onStructuralBlocked?.();
        return;
      }
      if (!structuralAllowed) return;
      setEdges((eds: any) => addEdge(params, eds));
    },
    [flowReadOnly, isRunning, onStoppedInteraction, onStructuralBlocked, setEdges, structuralAllowed]
  );

  // Expose addNode function to parent via callback
  useEffect(() => {
    // Store the addNode function that can be called from sidebar
    (window as any).__reactFlowAddNode = (nodeType: string) => {
      if (flowReadOnly) {
        onStoppedInteraction?.();
        return;
      }
      if (isRunning) {
        onStructuralBlocked?.();
        return;
      }
      if (!structuralAllowed) return;
      // Prevent adding Lead Bucket nodes (they're automatic)
      if (nodeType === 'leadSource') {
        return;
      }

      const factory = nodeFactories[nodeType];
      if (!factory) return;

      const currentNodes: any[] = (window as any).__reactFlowGetNodes?.() ?? [];

      // Only one Categorizer per flow.
      if (
        nodeType === 'aiCategorizer' &&
        currentNodes.some((n: any) => n.type === 'aiCategorizer')
      ) {
        return;
      }

      // Get viewport center or use default position
      let position = { x: 400, y: 300 };
      
      try {
        // Try to get viewport center from React Flow
        const reactFlowInstance = (window as any).__reactFlowInstance;
        if (reactFlowInstance) {
          const viewport = reactFlowInstance.getViewport();
          const bounds = reactFlowInstance.getBounds();
          position = {
            x: -viewport.x + (bounds.width || 800) / 2,
            y: -viewport.y + (bounds.height || 600) / 2,
          };
        }
      } catch (error) {
        // Fallback to default position
      }

      const newNode = factory(position);
      // Emails added after a Categorizer default to reply mode (sent in the
      // replied thread) - the common post-categorization action.
      if (
        nodeType === 'email' &&
        currentNodes.some((n: any) => n.type === 'aiCategorizer')
      ) {
        newNode.data = { ...newNode.data, send_mode: 'reply' };
      }
      setNodes((nds: any) => [...nds, newNode]);
    };

    // Store the editNode function that can be called from nodes
    (window as any).__reactFlowEditNode = (nodeId: string, nodeType: string) => {
      onEditNode(nodeId, nodeType);
    };

    (window as any).__reactFlowDeleteNode = (nodeId: string) => {
      if (flowReadOnly) {
        onStoppedInteraction?.();
        return;
      }
      if (isRunning) {
        onStructuralBlocked?.();
        return;
      }
      const currentNodes: any[] = (window as any).__reactFlowGetNodes?.() ?? [];
      const node = currentNodes.find((n: any) => n.id === nodeId);
      if (!node || node.type === 'leadSource' || node.data?.isRequired) return;
      const label = node.data?.label || node.type || 'Node';
      const deleteMode = isPaused ? 'paused' : 'draft';
      setPendingDelete({ removeChanges: [{ type: 'remove', id: nodeId }], labels: [label], deleteMode });
    };

    (window as any).__reactFlowDeleteEdge = (edgeId: string) => {
      if (flowReadOnly) {
        onStoppedInteraction?.();
        return;
      }
      if (isRunning) {
        onStructuralBlocked?.();
        return;
      }
      if (isPaused) {
        setPendingEdgeDelete({ edgeId });
        return;
      }
      onEdgesChange([{ type: 'remove', id: edgeId }]);
    };
  }, [campaignStatus, flowReadOnly, isPaused, isRunning, onEditNode, onEdgesChange, onStoppedInteraction, onStructuralBlocked, setNodes, structuralAllowed]);

  // Expose setNodes and getNodes for updating node data
  useEffect(() => {
    (window as any).__reactFlowSetNodes = setNodes;
    (window as any).__reactFlowSetEdges = setEdges;
    (window as any).__reactFlowGetNodes = () => nodes;
    (window as any).__reactFlowSetFlow = (nextNodes: any[], nextEdges: any[]) => {
      setNodes(nextNodes);
      setEdges(nextEdges);
    };
    (window as any).__reactFlowClearSelection = () => {
      setNodes((currentNodes: any[]) =>
        currentNodes.map((node: any) =>
          node.selected ? { ...node, selected: false } : node
        )
      );
      setEdges((currentEdges: any[]) =>
        currentEdges.map((edge: any) =>
          edge.selected ? { ...edge, selected: false } : edge
        )
      );
    };
    return () => {
      delete (window as any).__reactFlowSetFlow;
    };
  }, [setEdges, setNodes, nodes]);

  // Handle node clicks to open edit modal
  const handleNodeClick = useCallback((event: any, node: any) => {
    if (flowReadOnly) {
      onStoppedInteraction?.();
      return;
    }
    if (node && node.type) {
      onEditNode(node.id, node.type);
      setTimeout(() => {
        (window as any).__reactFlowClearSelection?.();
      }, 0);
    }
  }, [flowReadOnly, onEditNode, onStoppedInteraction]);

  const deleteConfirmTitle = pendingDelete
    ? pendingDelete.labels.length === 1
      ? formatFlowModalDeleteTitle(pendingDelete.labels[0]!)
      : `Delete ${pendingDelete.labels.length} nodes?`
    : '';

  const deleteConfirmMessage = pendingDelete
    ? pendingDelete.deleteMode === 'paused'
      ? FLOW_MODAL_DELETE_BODY_PAUSED
      : FLOW_MODAL_DELETE_BODY_DRAFT
    : '';

  return (
    <>
      <FlowCanvas
        mode="editor"
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: 'deletable' }}
        deleteKeyCode={null}
        fitView
        onInit={(instance: any) => {
          // Store React Flow instance for accessing viewport
          (window as any).__reactFlowInstance = instance;
        }}
        nodesConnectable={structuralAllowed}
      >
        <Controls />
      </FlowCanvas>
      <ConfirmModal
        visible={pendingDelete !== null}
        onClose={cancelPendingDelete}
        onConfirm={applyPendingDelete}
        title={deleteConfirmTitle}
        message={deleteConfirmMessage}
        confirmLabel="Delete"
        confirmVariant="destructive"
      />
      <ConfirmModal
        visible={pendingEdgeDelete !== null}
        onClose={() => setPendingEdgeDelete(null)}
        onConfirm={applyPendingEdgeDelete}
        title={FLOW_MODAL_DELETE_EDGE_TITLE}
        message={FLOW_MODAL_DELETE_EDGE_BODY}
        confirmLabel="Delete"
        confirmVariant="destructive"
      />
    </>
  );
}

export default function BuilderPage() {
  const { campaignId } = useLocalSearchParams<{ campaignId: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editingNode, setEditingNode] = useState<{ id: string; type: string; data: any } | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [initialFlowData, setInitialFlowData] = useState<{ nodes: any[]; edges: any[] } | null>(null);
  const [flowConflict, setFlowConflict] = useState<{
    localFlow: CampaignFlowData;
    serverFlow: CampaignFlowData;
    serverRevision: string;
  } | null>(null);
  const hasLoadedFlowRef = useRef(false);
  const lastSavedFlowRef = useRef<string | null>(null);
  const flowRevisionRef = useRef<string | null>(null);
  const pendingSaveRef = useRef<{ nodes: any[]; edges: any[] } | null>(null);
  const lastSaveFailureRef = useRef<{ flowHash: string; message: string } | null>(null);
  const isSavingRef = useRef(false);
  const queuedSaveRef = useRef<{ nodes: any[]; edges: any[] } | null>(null);
  const lastSavedFlowDataRef = useRef<CampaignFlowData | null>(null);
  const lastAppendToastRevisionRef = useRef<string | null>(null);
  const orphanHealPendingRef = useRef<CampaignFlowData | null>(null);
  const orphanHealAttemptedRef = useRef(false);
  const [pauseModalVisible, setPauseModalVisible] = useState(false);
  const [stoppedInfoModalVisible, setStoppedInfoModalVisible] = useState(false);
  const stoppedInfoShownRef = useRef(false);

  useEffect(() => {
    if (!campaignId) {
      router.replace('/campaigns');
    }
  }, [campaignId, router]);

  // Load campaign and extract flow_data
  useEffect(() => {
    const loadCampaign = async () => {
      if (!campaignId) return;
      
      setIsLoading(true);
      try {
        const data = await getCampaignById(campaignId);
        if (data?.deleted_at) {
          router.replace('/campaigns');
          return;
        }
        setCampaign(data);
        
        // Extract and parse flow_data
        if (data?.flow_data && !hasLoadedFlowRef.current) {
          try {
            const flowData = typeof data.flow_data === 'string' 
              ? JSON.parse(data.flow_data) 
              : data.flow_data;
            
            if (flowData && typeof flowData === 'object') {
              const sanitizedFlowData = sanitizeFlowData(
                Array.isArray(flowData.nodes) ? flowData.nodes : [],
                Array.isArray(flowData.edges) ? flowData.edges : []
              );
              setInitialFlowData(sanitizedFlowData);
              lastSavedFlowRef.current = stableSerializeFlow(sanitizedFlowData);
              lastSavedFlowDataRef.current = sanitizedFlowData;
              flowRevisionRef.current = await computeFlowRevision(sanitizedFlowData);
              hasLoadedFlowRef.current = true;
              if (flowNeedsOrphanEdgeHeal(flowData, sanitizedFlowData)) {
                orphanHealPendingRef.current = sanitizedFlowData;
              }
            }
          } catch (error) {
            console.error('Failed to parse flow_data:', error);
            // Fallback to empty flow
            const emptyFlow = { nodes: [], edges: [] };
            setInitialFlowData(emptyFlow);
            lastSavedFlowRef.current = stableSerializeFlow(emptyFlow);
            lastSavedFlowDataRef.current = emptyFlow;
            flowRevisionRef.current = await computeFlowRevision(emptyFlow);
            hasLoadedFlowRef.current = true;
          }
        } else if (!data?.flow_data && !hasLoadedFlowRef.current) {
          // No flow_data exists, start with empty
          const emptyFlow = { nodes: [], edges: [] };
          setInitialFlowData(emptyFlow);
          lastSavedFlowRef.current = stableSerializeFlow(emptyFlow);
          lastSavedFlowDataRef.current = emptyFlow;
          flowRevisionRef.current = await computeFlowRevision(emptyFlow);
          hasLoadedFlowRef.current = true;
        }
      } catch (error) {
        console.error('Failed to load campaign:', error);
        setSaveStatus('error');
      } finally {
        setIsLoading(false);
      }
    };

    loadCampaign();
  }, [campaignId, router]);

  useEffect(() => {
    if (isLoading || campaign?.status !== 'stopped' || stoppedInfoShownRef.current) return;
    stoppedInfoShownRef.current = true;
    setStoppedInfoModalVisible(true);
  }, [campaign?.status, isLoading]);

  const reloadCampaign = useCallback(async (silent = false) => {
    if (!campaignId) return;
    if (!silent) setIsLoading(true);
    try {
      const data = await getCampaignById(campaignId);
      if (data?.deleted_at) {
        router.replace('/campaigns');
        return;
      }
      setCampaign(data);
    } catch (error) {
      console.error('Failed to reload campaign:', error);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [campaignId, router]);

  const {
    isPausing,
    isStarting,
    isStopping,
    handlePause,
    handleResume,
    handleStop,
  } = useCampaignStatusActions(campaignId, reloadCampaign);

  const revertCanvasToLastSaved = useCallback(() => {
    const saved = lastSavedFlowDataRef.current;
    if (saved && typeof window !== 'undefined' && (window as any).__reactFlowSetFlow) {
      (window as any).__reactFlowSetFlow(saved.nodes, saved.edges);
    }
  }, []);

  const showStoppedToast = useCallback(() => {
    toast.error(FLOW_TOAST_STOPPED);
  }, [toast]);

  const showStructuralBlocked = useCallback(() => {
    setPauseModalVisible(true);
  }, []);

  const handleConfirmPause = useCallback(async () => {
    await handlePause();
    setPauseModalVisible(false);
  }, [handlePause]);

  const persistPreparedFlow = useCallback(async (preparedFlow: CampaignFlowData) => {
    if (!campaignId) return;
    const saveResult = await updateCampaignFlowData(campaignId, preparedFlow as any, 'builder');
    const sanitizedPrepared = sanitizeFlowData(preparedFlow.nodes as any[], preparedFlow.edges as any[]);
    lastSavedFlowRef.current = stableSerializeFlow(sanitizedPrepared);
    lastSavedFlowDataRef.current = sanitizedPrepared;
    const nextRevision = await computeFlowRevision(sanitizedPrepared);
    flowRevisionRef.current = nextRevision;
    lastSaveFailureRef.current = null;
    setCampaign((prev) => (prev ? { ...prev, flow_data: preparedFlow as any, status: saveResult.campaign.status } : prev));

    // Sync lead-source field keys only — do not rehydrate the whole graph. Full
    // __reactFlowSetFlow after every save snaps node positions back to the save
    // snapshot and re-fires onFlowChange, which loops save ↔ position bounce.
    const preparedLeadSource = preparedFlow.nodes.find((node) => node.type === 'leadSource');
    const setNodes = (window as any).__reactFlowSetNodes;
    if (preparedLeadSource && typeof setNodes === 'function') {
      const nextCustom = preparedLeadSource.data?.customFieldKeys ?? [];
      const nextMapped = preparedLeadSource.data?.mappedStandardFieldKeys;
      setNodes((currentNodes: any[]) => {
        let changed = false;
        const nextNodes = currentNodes.map((node: any) => {
          if (node.type !== 'leadSource') return node;
          const prevCustom = node.data?.customFieldKeys ?? [];
          const prevMapped = node.data?.mappedStandardFieldKeys;
          const sameCustom =
            prevCustom.length === nextCustom.length
            && prevCustom.every((key: string, i: number) => key === nextCustom[i]);
          const sameMapped =
            JSON.stringify(prevMapped ?? null) === JSON.stringify(nextMapped ?? null);
          if (sameCustom && sameMapped) return node;
          changed = true;
          return {
            ...node,
            data: {
              ...node.data,
              customFieldKeys: nextCustom,
              mappedStandardFieldKeys: nextMapped,
            },
          };
        });
        return changed ? nextNodes : currentNodes;
      });
    }

    if (
      saveResult.reactivated_count > 0
      && lastAppendToastRevisionRef.current !== nextRevision
    ) {
      lastAppendToastRevisionRef.current = nextRevision;
      toast.info(formatFlowAppendReactivatedToast(saveResult.reactivated_count));
    }

    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  }, [campaignId, toast]);

  // Persist orphan-edge cleanup so DB matches the sanitized canvas (running OK once SQL
  // classifies on orphan-pruned graphs).
  useEffect(() => {
    if (isLoading || !campaign || !campaignId || orphanHealAttemptedRef.current) return;
    const pending = orphanHealPendingRef.current;
    if (!pending) return;
    if (campaign.status === 'stopped') {
      orphanHealPendingRef.current = null;
      return;
    }
    orphanHealAttemptedRef.current = true;
    orphanHealPendingRef.current = null;
    void persistPreparedFlow(pending).catch((error) => {
      console.error('Failed to persist orphan-edge heal on open:', error);
      orphanHealAttemptedRef.current = false;
    });
  }, [campaign, campaignId, isLoading, persistPreparedFlow]);

  const showSaveFailureToast = useCallback((flowHash: string, message: string) => {
    const previous = lastSaveFailureRef.current;
    if (previous?.flowHash === flowHash && previous.message === message) {
      return;
    }
    lastSaveFailureRef.current = { flowHash, message };
    toast.error(message);
  }, [toast]);

  const attemptFlowSave = useCallback(async (nodes: any[], edges: any[], forceOverwrite = false) => {
    if (!campaignId) return;
    const sanitizedFlowData = sanitizeFlowData(nodes, edges);
    const serializedFlow = stableSerializeFlow(sanitizedFlowData);
    if (!forceOverwrite && serializedFlow === lastSavedFlowRef.current) {
      return;
    }

    setSaveStatus('saving');
    try {
      const latestCampaign = await getCampaignById(campaignId);
      if (!latestCampaign) {
        throw new Error('Campaign not found');
      }
      const serverFlow = sanitizeFlowData(
        (latestCampaign.flow_data as CampaignFlowData | null)?.nodes ?? [],
        (latestCampaign.flow_data as CampaignFlowData | null)?.edges ?? [],
      );
      const serverRevision = await computeFlowRevision(serverFlow);

      // Detect a genuine external edit by comparing canonical revision hashes: the
      // server holds content that differs from what this tab last persisted. Hashes
      // are key-order- and position-insensitive, so a Postgres jsonb round-trip never
      // trips this. `forceOverwrite` (Keep my version) bypasses the check.
      const isFirstSave = flowRevisionRef.current === null;
      const externallyChanged =
        !forceOverwrite && !isFirstSave && serverRevision !== flowRevisionRef.current;
      if (externallyChanged) {
        setFlowConflict({
          localFlow: sanitizedFlowData,
          serverFlow,
          serverRevision,
        });
        pendingSaveRef.current = { nodes, edges };
        setSaveStatus('idle');
        return;
      }

      let prepared;
      try {
        prepared = await prepareFlowSave({
          incomingFlow: sanitizedFlowData,
          existingFlow: serverFlow,
          campaignStatus: latestCampaign.status,
          phase: 'draft',
          // Rebase on the exact revision we just fetched so the advisory revision
          // gate is always satisfied for our own writes and never throws spuriously.
          ifMatch: serverRevision,
        });
      } catch (error) {
        if (error instanceof FlowRevisionConflictError) {
          setFlowConflict({
            localFlow: sanitizedFlowData,
            serverFlow,
            serverRevision,
          });
          pendingSaveRef.current = { nodes, edges };
          setSaveStatus('idle');
          return;
        }
        if (error instanceof FlowPrepareValidationError) {
          showSaveFailureToast(serializedFlow, error.issues[0]?.message || error.message);
          revertCanvasToLastSaved();
        } else if (error instanceof FlowEditForbiddenError) {
          showSaveFailureToast(serializedFlow, error.message);
          revertCanvasToLastSaved();
        } else {
          console.error('Failed to save flow:', error);
          showSaveFailureToast(
            serializedFlow,
            error instanceof Error ? error.message : 'Flow validation failed',
          );
          revertCanvasToLastSaved();
        }
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 3000);
        return;
      }

      await persistPreparedFlow(prepared.flow);
    } catch (error) {
      console.error('Failed to save flow:', error);
      showSaveFailureToast(
        serializedFlow,
        error instanceof Error ? error.message : 'Flow save failed',
      );
      revertCanvasToLastSaved();
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }, [campaignId, persistPreparedFlow, revertCanvasToLastSaved, showSaveFailureToast]);

  // Single-flight save loop: only one save runs at a time; edits during a save
  // coalesce into one trailing save that reads the fresh post-save revision refs.
  const drainSaves = useCallback(async () => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    try {
      while (queuedSaveRef.current) {
        const next = queuedSaveRef.current;
        queuedSaveRef.current = null;
        await attemptFlowSave(next.nodes, next.edges);
      }
    } finally {
      isSavingRef.current = false;
    }
  }, [attemptFlowSave]);

  const debouncedDrainSaves = useMemo(
    () => debounce(() => { void drainSaves(); }, 1000),
    [drainSaves]
  );

  // Handle flow changes
  const handleFlowChange = useCallback((nodes: any[], edges: any[]) => {
    const status = campaign?.status;
    const sanitizedIncoming = sanitizeFlowData(nodes, edges);
    // Skip no-op echoes (programmatic setFlow, metadata flag sync, post-save
    // lead-source patch) so we don't queue a save loop.
    if (stableSerializeFlow(sanitizedIncoming) === lastSavedFlowRef.current) {
      return;
    }

    if (isFlowReadOnly(status)) {
      showStoppedToast();
      revertCanvasToLastSaved();
      return;
    }

    const lastSaved = lastSavedFlowDataRef.current;
    if (status === 'running' && lastSaved) {
      const change = classifyFlowChange(lastSaved, sanitizedIncoming);
      if (change.kind === 'structural') {
        showStructuralBlocked();
        revertCanvasToLastSaved();
        return;
      }
    }

    queuedSaveRef.current = { nodes, edges };
    debouncedDrainSaves();
  }, [campaign?.status, debouncedDrainSaves, revertCanvasToLastSaved, showStoppedToast, showStructuralBlocked]);

  if (!campaignId) {
    return (
      <PageLayout scrollable={false}>
        <View className="flex-1 items-center justify-center">
          <Text className="text-gray-300 font-instrument">Redirecting…</Text>
        </View>
      </PageLayout>
    );
  }

  // React Flow only works on web
  if (Platform.OS !== 'web') {
    return (
      <PageLayout scrollable={false}>
        <View className="flex-1 items-center justify-center p-6">
          <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6 max-w-md">
            <Text className="text-white font-instrument-semibold text-xl mb-2">
              Builder not available on mobile
            </Text>
            <Text className="text-gray-400 font-instrument text-sm">
              The flow builder is currently only available on web. Please use a web browser to access this feature.
            </Text>
          </View>
        </View>
      </PageLayout>
    );
  }

  const handleAddNode = (nodeType: string) => {
    if (isFlowReadOnly(campaign?.status)) {
      showStoppedToast();
      return;
    }
    if (campaign?.status === 'running') {
      showStructuralBlocked();
      return;
    }
    if (nodeType === 'aiCategorizer') {
      const nodes: any[] = (window as any).__reactFlowGetNodes?.() ?? [];
      if (nodes.some((n: any) => n.type === 'aiCategorizer')) {
        toast.error('A flow can only have one Categorizer.');
        return;
      }
    }
    // Call the stored function to add node
    if ((window as any).__reactFlowAddNode) {
      (window as any).__reactFlowAddNode(nodeType);
    }
  };

  const handleEditNode = (nodeId: string, nodeType: string) => {
    if (isFlowReadOnly(campaign?.status)) {
      showStoppedToast();
      return;
    }
    (window as any).__reactFlowClearSelection?.();
    // Find the node in React Flow state
    if ((window as any).__reactFlowGetNodes) {
      const nodes = (window as any).__reactFlowGetNodes();
      const node = nodes.find((n: any) => n.id === nodeId);
      if (node) {
        setEditingNode({ id: nodeId, type: nodeType, data: node.data });
      }
    }
  };

  const handleSaveNode = (updatedData: any) => {
    if (!editingNode) return;
    const { keepModalOpen, ...persistedData } = updatedData ?? {};

    // Update the node data in React Flow
    if ((window as any).__reactFlowSetNodes) {
      const setNodes = (window as any).__reactFlowSetNodes;
      setNodes((nds: any[]) => 
        nds.map((node: any) => 
          node.id === editingNode.id
            ? { ...node, data: { ...node.data, ...persistedData } }
            : node
        )
      );
    }

    if (keepModalOpen) {
      setEditingNode((prev) =>
        prev
          ? {
              ...prev,
              data: { ...prev.data, ...persistedData },
            }
          : prev,
      );
      return;
    }

    setEditingNode(null);
  };

  const handleCloseModal = () => {
    (window as any).__reactFlowClearSelection?.();
    setEditingNode(null);
  };

  const campaignStatus = campaign?.status;
  const showStatusMenu =
    (campaignStatus === 'running' || campaignStatus === 'paused' || campaignStatus === 'stopped') &&
    !isLoading;
  const showFlowEditBadge = campaignStatus === 'running' || campaignStatus === 'paused';
  const statusMenuStatus =
    campaignStatus === 'running' || campaignStatus === 'paused' || campaignStatus === 'stopped'
      ? campaignStatus
      : 'running';

  return (
    <View className="flex-1 bg-[#121212] flex-row">
      <NavBar />
      
      {/* Main Content Area - React Flow */}
      <View className="flex-1 relative">
        {/* Header */}
        <View
          style={{
            backgroundColor: '#121212',
            borderBottomWidth: 1,
            borderBottomColor: '#2A2A2A',
            zIndex: 10,
          }}
        >
          <View 
            style={{
              paddingHorizontal: 24,
              paddingVertical: 16,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Breadcrumb
              items={[
                { label: 'Campaigns', href: '/campaigns' },
                {
                  label: isLoading ? 'Loading...' : (campaign?.name || 'Campaign'),
                  href: campaignId ? `/campaigns/${campaignId}` : undefined,
                },
                { label: FLOW_EDITOR_PAGE_LABEL },
              ]}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {/* Save Status Indicator */}
              {saveStatus !== 'idle' && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {saveStatus === 'saving' && (
                    <>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FBBF24' }} />
                      <Text className="text-gray-400 font-instrument text-sm">Saving...</Text>
                    </>
                  )}
                  {saveStatus === 'saved' && (
                    <>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#F3440D' }} />
                      <Text className="text-gray-400 font-instrument text-sm">Saved</Text>
                    </>
                  )}
                  {saveStatus === 'error' && (
                    <>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444' }} />
                      <Text className="text-red-400 font-instrument text-sm">Save failed</Text>
                    </>
                  )}
                </View>
              )}
              {showFlowEditBadge && campaign?.status && (
                <FlowStructureLockedBadge status={campaign.status} />
              )}
              {showStatusMenu ? (
                <CampaignStatusMenu
                  status={statusMenuStatus}
                  campaignName={campaign?.name ?? undefined}
                  isPausing={isPausing}
                  isStarting={isStarting}
                  isStopping={isStopping}
                  onPause={handlePause}
                  onResume={handleResume}
                  onStop={handleStop}
                />
              ) : null}
              {campaignId && (
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={() =>
                    router.push({
                      pathname: '/campaigns/[id]/mission-control',
                      params: { id: campaignId },
                    })
                  }
                >
                  Mission Control
                </Button>
              )}
            </View>
          </View>
        </View>

        {/* Flow Editor */}
        <View 
          style={{ 
            flex: 1,
            position: 'relative',
            backgroundColor: 'transparent'
          }}
        >
          {initialFlowData !== null && isReactFlowWebAvailable() ? (
            <FlowEditor 
              onEditNode={handleEditNode}
              initialNodes={initialFlowData.nodes}
              initialEdges={initialFlowData.edges}
              onFlowChange={handleFlowChange}
              campaignStatus={campaign?.status}
              onStructuralBlocked={showStructuralBlocked}
              onStoppedInteraction={showStoppedToast}
            />
          ) : initialFlowData !== null ? (
            <View className="flex-1 items-center justify-center">
              <Text className="text-white font-instrument">React Flow not available</Text>
            </View>
          ) : (
            <View className="flex-1 items-center justify-center">
              <Text className="text-gray-400 font-instrument">Loading flow...</Text>
            </View>
          )}
        </View>
      </View>
      
      {/* Node Sidebar - Right side */}
      <NodeSidebar onAddNode={handleAddNode} />

      {/* Node Modal */}
      {editingNode && (() => {
        const ModalComponent = nodeModalRegistry[editingNode.type];
        if (!ModalComponent) return null;
        
        // For Lead Bucket node, pass campaign and bucket IDs
        let modalData = editingNode.data;
        if (editingNode.type === 'leadSource') {
          modalData = {
            ...editingNode.data,
            campaignId: campaignId,
            bucketId: campaign?.bucket_id || editingNode.data?.bucketId,
          };
        } else if (editingNode.type === 'email') {
          const { customFieldKeys, mappedStandardFieldKeys } = getLeadSourceFieldKeysFromFlow();
          const flowNodes: any[] = (window as any).__reactFlowGetNodes?.() ?? [];
          modalData = {
            ...editingNode.data,
            campaignId: campaignId,
            campaignStatus: campaign?.status,
            customFieldKeys,
            mappedStandardFieldKeys,
            flowHasCategorizer: flowNodes.some((n: any) => n.type === 'aiCategorizer'),
          };
        } else if (editingNode.type === 'aiCategorizer') {
          modalData = {
            ...editingNode.data,
            campaignId: campaignId,
          };
        } else if (editingNode.type === 'dataSender') {
          const { customFieldKeys, mappedStandardFieldKeys } = getLeadSourceFieldKeysFromFlow();
          modalData = {
            ...editingNode.data,
            customFieldKeys,
            mappedStandardFieldKeys,
          };
        }
        
        return (
          <ModalComponent
            visible={!!editingNode}
            onClose={handleCloseModal}
            onSave={handleSaveNode}
            initialData={modalData}
          />
        );
      })()}
      <SmartleadRestrictedModal
        visible={!isLoading && isSmartleadCampaign(campaign)}
        onClose={() => {}}
        campaignId={campaignId ?? null}
        isOnStatsPage={false}
      />
      {flowConflict && (
        <FlowConflictModal
          visible
          localFlow={flowConflict.localFlow}
          serverFlow={flowConflict.serverFlow}
          onClose={() => {
            setFlowConflict(null);
            pendingSaveRef.current = null;
          }}
          onKeepLocal={async () => {
            flowRevisionRef.current = flowConflict.serverRevision;
            setFlowConflict(null);
            const pending = pendingSaveRef.current;
            pendingSaveRef.current = null;
            if (pending) {
              await attemptFlowSave(pending.nodes, pending.edges, true);
            }
          }}
          onUseServer={async () => {
            const serverFlow = flowConflict.serverFlow;
            setFlowConflict(null);
            pendingSaveRef.current = null;
            setInitialFlowData({ nodes: serverFlow.nodes as any[], edges: serverFlow.edges as any[] });
            lastSavedFlowRef.current = stableSerializeFlow(serverFlow);
            lastSavedFlowDataRef.current = serverFlow;
            flowRevisionRef.current = await computeFlowRevision(serverFlow);
            setCampaign((prev) => (prev ? { ...prev, flow_data: serverFlow as any } : prev));
            if (typeof window !== 'undefined' && (window as any).__reactFlowSetFlow) {
              (window as any).__reactFlowSetFlow(serverFlow.nodes, serverFlow.edges);
            }
          }}
        />
      )}
      <ConfirmModal
        visible={pauseModalVisible}
        onClose={() => !isPausing && setPauseModalVisible(false)}
        onConfirm={() => {
          if (!isPausing) void handleConfirmPause();
        }}
        title={FLOW_MODAL_PAUSE_TITLE}
        message={FLOW_MODAL_PAUSE_BODY}
        confirmLabel={isPausing ? 'Pausing…' : FLOW_MODAL_PAUSE_CONFIRM}
        maxWidth="lg"
        descriptionNumberOfLines={null}
      />
      <AccessIssueDialog
        visible={stoppedInfoModalVisible}
        onClose={() => setStoppedInfoModalVisible(false)}
        title={FLOW_MODAL_STOPPED_TITLE}
        message={FLOW_MODAL_STOPPED_BODY}
        primaryLabel={FLOW_MODAL_STOPPED_CONFIRM}
        onPrimary={() => setStoppedInfoModalVisible(false)}
        wide
      />
    </View>
  );
}
