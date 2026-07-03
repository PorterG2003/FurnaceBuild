import { useEffect, useCallback, useState, useMemo, useRef } from 'react';
import { View, Platform, Text, Pressable } from 'react-native';
import { ConfirmModal } from '@/components/ui/modals';
import { useToast } from '@/components/ui/feedback';
import { Breadcrumb } from '@/components/ui/layout';
import { NavBar } from '@/components/ui/layout/NavBar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getCampaignById, updateCampaignFlowData } from '@/lib/supabase/services/campaigns';
import type { Campaign } from '@/lib/supabase/types';
import { debounce } from '@/lib/utils/debounce';
import { isSmartleadCampaign } from '@/lib/campaigns/utils';
import { SmartleadRestrictedModal } from '@/components/campaigns/SmartleadRestrictedModal';
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
import { backfillCategorizerEdgeHandles } from '@/lib/categorizer';
import {
  FlowCanvas,
  isReactFlowWebAvailable,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
} from '@/lib/flow';

type FlowNodeRecord = Record<string, any>;
type FlowEdgeRecord = Record<string, any>;

function sanitizeFlowNode(node: FlowNodeRecord): FlowNodeRecord {
  const {
    selected: _selected,
    dragging: _dragging,
    measured: _measured,
    positionAbsolute: _positionAbsolute,
    resizing: _resizing,
    ...rest
  } = node;

  return {
    ...rest,
    deletable: node.type === 'leadSource' || node.data?.isRequired ? false : rest.deletable,
  };
}

function sanitizeFlowEdge(edge: FlowEdgeRecord): FlowEdgeRecord {
  const { selected: _selected, type, ...rest } = edge;
  if (type === 'deletable') {
    return rest;
  }
  return type !== undefined ? { ...rest, type } : rest;
}

function sanitizeFlowData(
  nodes: FlowNodeRecord[] | null | undefined,
  edges: FlowEdgeRecord[] | null | undefined,
): { nodes: FlowNodeRecord[]; edges: FlowEdgeRecord[] } {
  const sanitizedNodes = Array.isArray(nodes) ? nodes.map((node) => sanitizeFlowNode(node)) : [];

  const sanitizedEdges = Array.isArray(edges)
    ? backfillCategorizerEdgeHandles(edges.map((edge) => sanitizeFlowEdge(edge)), sanitizedNodes)
    : [];

  return { nodes: sanitizedNodes, edges: sanitizedEdges };
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

interface FlowEditorProps {
  onEditNode: (nodeId: string, nodeType: string) => void;
  initialNodes?: any[];
  initialEdges?: any[];
  onFlowChange?: (nodes: any[], edges: any[]) => void;
  campaignStatus?: Campaign['status'] | null;
}

function FlowEditor({
  onEditNode,
  initialNodes = [],
  initialEdges = [],
  onFlowChange,
  campaignStatus,
}: FlowEditorProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState!(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState!(initialEdges);
  
  // Track if initial load is complete to avoid saving during initialization
  const isInitialLoadRef = useRef(true);
  const hasInitializedRef = useRef(false);
  
  // Load initial data when props change (only once)
  useEffect(() => {
    if (!hasInitializedRef.current && (initialNodes.length > 0 || initialEdges.length > 0)) {
      setNodes(initialNodes);
      setEdges(initialEdges);
      hasInitializedRef.current = true;
      isInitialLoadRef.current = true;
      // Reset flag after a brief delay to allow React Flow to initialize
      setTimeout(() => {
        isInitialLoadRef.current = false;
      }, 500);
    } else if (!hasInitializedRef.current) {
      // Even if empty, mark as initialized
      hasInitializedRef.current = true;
      setTimeout(() => {
        isInitialLoadRef.current = false;
      }, 500);
    }
  }, [initialNodes, initialEdges, setNodes, setEdges]);
  
  // Notify parent of changes (for saving)
  useEffect(() => {
    if (!isInitialLoadRef.current && onFlowChange) {
      onFlowChange(nodes, edges);
    }
  }, [nodes, edges, onFlowChange]);

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
  }, [setNodes]); // Only run once on mount

  // Pending delete confirmation state
  const [pendingDelete, setPendingDelete] = useState<{
    removeChanges: any[];
    labels: string[];
    isLive: boolean;
  } | null>(null);

  const applyPendingDelete = useCallback(() => {
    if (!pendingDelete) return;
    onNodesChange(pendingDelete.removeChanges);
    setPendingDelete(null);
  }, [onNodesChange, pendingDelete]);

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
    (params: any) => setEdges((eds: any) => addEdge(params, eds)),
    [setEdges]
  );

  // Expose addNode function to parent via callback
  useEffect(() => {
    // Store the addNode function that can be called from sidebar
    (window as any).__reactFlowAddNode = (nodeType: string) => {
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
      const currentNodes: any[] = (window as any).__reactFlowGetNodes?.() ?? [];
      const node = currentNodes.find((n: any) => n.id === nodeId);
      if (!node || node.type === 'leadSource' || node.data?.isRequired) return;
      const label = node.data?.label || node.type || 'Node';
      const isLive = !!(campaignStatus && campaignStatus !== 'draft');
      setPendingDelete({ removeChanges: [{ type: 'remove', id: nodeId }], labels: [label], isLive });
    };

    (window as any).__reactFlowDeleteEdge = (edgeId: string) => {
      onEdgesChange([{ type: 'remove', id: edgeId }]);
    };
  }, [campaignStatus, onEditNode, onEdgesChange, setNodes]);

  // Expose setNodes and getNodes for updating node data
  useEffect(() => {
    (window as any).__reactFlowSetNodes = setNodes;
    (window as any).__reactFlowSetEdges = setEdges;
    (window as any).__reactFlowGetNodes = () => nodes;
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
  }, [setEdges, setNodes, nodes]);

  // Handle node clicks to open edit modal
  const handleNodeClick = useCallback((event: any, node: any) => {
    // Only trigger edit on click (not drag)
    // React Flow will handle dragging separately
    if (node && node.type) {
      onEditNode(node.id, node.type);
      setTimeout(() => {
        (window as any).__reactFlowClearSelection?.();
      }, 0);
    }
  }, [onEditNode]);

  const deleteConfirmTitle = pendingDelete
    ? pendingDelete.labels.length === 1
      ? `Delete "${pendingDelete.labels[0]}"?`
      : `Delete ${pendingDelete.labels.length} nodes?`
    : '';

  const deleteConfirmMessage = pendingDelete
    ? [
        pendingDelete.isLive
          ? 'This campaign is already live. Deleting nodes can affect active enrollments and future sends.'
          : null,
        'This action cannot be undone.',
      ]
        .filter(Boolean)
        .join(' ')
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
  const hasLoadedFlowRef = useRef(false);
  const lastSavedFlowRef = useRef<string | null>(null);

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
              lastSavedFlowRef.current = JSON.stringify(sanitizedFlowData);
              hasLoadedFlowRef.current = true;
            }
          } catch (error) {
            console.error('Failed to parse flow_data:', error);
            // Fallback to empty flow
            const emptyFlow = { nodes: [], edges: [] };
            setInitialFlowData(emptyFlow);
            lastSavedFlowRef.current = JSON.stringify(emptyFlow);
            hasLoadedFlowRef.current = true;
          }
        } else if (!data?.flow_data && !hasLoadedFlowRef.current) {
          // No flow_data exists, start with empty
          const emptyFlow = { nodes: [], edges: [] };
          setInitialFlowData(emptyFlow);
          lastSavedFlowRef.current = JSON.stringify(emptyFlow);
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
  }, [campaignId]);

  // Debounced save function
  const saveFlowData = useMemo(
    () => debounce(async (nodes: any[], edges: any[]) => {
      if (!campaignId) return;
      const sanitizedFlowData = sanitizeFlowData(nodes, edges);
      const serializedFlow = JSON.stringify(sanitizedFlowData);
      if (serializedFlow === lastSavedFlowRef.current) {
        return;
      }

      setSaveStatus('saving');
      try {
        await updateCampaignFlowData(campaignId, sanitizedFlowData as any, 'builder');
        lastSavedFlowRef.current = serializedFlow;
        setSaveStatus('saved');
        // Reset to idle after 2 seconds
        setTimeout(() => {
          setSaveStatus('idle');
        }, 2000);
      } catch (error) {
        console.error('Failed to save flow:', error);
        setSaveStatus('error');
        // Reset error status after 3 seconds
        setTimeout(() => {
          setSaveStatus('idle');
        }, 3000);
      }
    }, 1000), // 1 second debounce
    [campaignId]
  );

  // Handle flow changes
  const handleFlowChange = useCallback((nodes: any[], edges: any[]) => {
    saveFlowData(nodes, edges);
  }, [saveFlowData]);

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
              {campaignId && (
                <View>
                  <Pressable
                    onPress={() => router.push({ pathname: '/campaigns/[id]/mission-control', params: { id: campaignId } })}
                    className="px-4 py-2 rounded-lg border border-[#3A3A3A] bg-[#2A2A2A]"
                  >
                    <Text className="text-white font-instrument-medium text-sm">Mission Control</Text>
                  </Pressable>
                </View>
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
          {/* Floating Mission Control button - bottom right */}
          {campaignId && (
            <Pressable
              onPress={() => router.push({ pathname: '/campaigns/[id]/mission-control', params: { id: campaignId } })}
              style={{
                position: 'absolute',
                right: 24,
                bottom: 24,
                backgroundColor: '#f85102',
                paddingHorizontal: 20,
                paddingVertical: 14,
                borderRadius: 12,
                zIndex: 10,
                ...(typeof window !== 'undefined'
                  ? { boxShadow: '0px 2px 4px rgba(0,0,0,0.25)' }
                  : { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 4 }),
              }}
            >
              <Text className="text-white font-instrument-semibold text-sm">
                Mission Control
              </Text>
            </Pressable>
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
    </View>
  );
}
