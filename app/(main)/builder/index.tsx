import { useEffect, useCallback, useState, useMemo, useRef } from 'react';
import { View, Platform, Text, Pressable } from 'react-native';
import { Button } from '@/components/ui/button';
import { Breadcrumb } from '@/components/ui/layout';
import { NavBar } from '@/components/ui/layout/NavBar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getCampaignById, getCampaignMailboxes, updateCampaign } from '@/lib/supabase/services/campaigns';
import type { Campaign } from '@/lib/supabase/types';
import { debounce } from '@/lib/utils/debounce';
import { nodeTypes } from './nodes/nodeTypes';
import { NodeSidebar } from './components/NodeSidebar';
import { nodeModalRegistry } from './components/nodeModals';
import { 
  createEmailNode,
  createLeadSourceNode,
  createWaitTimeNode,
  createAICategorizerNode,
  createDataSenderNode,
} from './nodes/factories';

// Conditionally import React Flow only on web
let ReactFlow: any = null;
let ReactFlowProvider: any = null;
let FlowBackground: any = null;
let Controls: any = null;
let MiniMap: any = null;
let addEdge: any = null;
let useNodesState: any = null;
let useEdgesState: any = null;
let Handle: any = null;

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  try {
    // Import CSS
    require('@xyflow/react/dist/style.css');
    
    // Dynamic require for React Flow
    const ReactFlowModule = require('@xyflow/react');
    ReactFlow = ReactFlowModule.default || ReactFlowModule.ReactFlow;
    ReactFlowProvider = ReactFlowModule.ReactFlowProvider;
    FlowBackground = ReactFlowModule.Background;
    Controls = ReactFlowModule.Controls;
    MiniMap = ReactFlowModule.MiniMap;
    addEdge = ReactFlowModule.addEdge;
    useNodesState = ReactFlowModule.useNodesState;
    useEdgesState = ReactFlowModule.useEdgesState;
    Handle = ReactFlowModule.Handle;
  } catch (error) {
    console.error('Failed to load React Flow:', error);
  }
}

// Note: Initial nodes/edges are now passed as props to FlowEditor

function hasFlowBuilt(campaign: Campaign | null): boolean {
  if (!campaign?.flow_data) return false;
  try {
    const fd =
      typeof campaign.flow_data === 'string'
        ? JSON.parse(campaign.flow_data)
        : campaign.flow_data;
    const nodes = Array.isArray((fd as any)?.nodes) ? (fd as any).nodes : [];
    return nodes.length > 0;
  } catch {
    return false;
  }
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
}

function FlowEditor({ onEditNode, initialNodes = [], initialEdges = [], onFlowChange }: FlowEditorProps) {
  if (!useNodesState || !useEdgesState || !addEdge || !ReactFlow || !ReactFlowProvider) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-white font-instrument">React Flow not available</Text>
      </View>
    );
  }

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  
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

  // Prevent deletion of Lead Bucket node
  const handleNodesChange = useCallback((changes: any[]) => {
    // Filter out any delete changes for Lead Bucket nodes
    const filteredChanges = changes.filter((change: any) => {
      if (change.type === 'remove') {
        const node = nodes.find((n: any) => n.id === change.id);
        // Prevent deletion of Lead Bucket nodes
        if (node?.type === 'leadSource' || node?.data?.isRequired) {
          return false;
        }
      }
      return true;
    });
    
    if (filteredChanges.length > 0) {
      onNodesChange(filteredChanges);
    }
  }, [nodes, onNodesChange]);

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
      setNodes((nds: any) => [...nds, newNode]);
    };

    // Store the editNode function that can be called from nodes
    (window as any).__reactFlowEditNode = (nodeId: string, nodeType: string) => {
      onEditNode(nodeId, nodeType);
    };
  }, [setNodes, onEditNode]);

  // Expose setNodes and getNodes for updating node data
  useEffect(() => {
    (window as any).__reactFlowSetNodes = setNodes;
    (window as any).__reactFlowGetNodes = () => nodes;
  }, [setNodes, nodes]);

  // Handle node clicks to open edit modal
  const handleNodeClick = useCallback((event: any, node: any) => {
    // Only trigger edit on click (not drag)
    // React Flow will handle dragging separately
    if (node && node.type) {
      onEditNode(node.id, node.type);
    }
  }, [onEditNode]);

  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        style={{ width: '100%', height: '100%' }}
        onInit={(instance: any) => {
          // Store React Flow instance for accessing viewport
          (window as any).__reactFlowInstance = instance;
        }}
      >
        <FlowBackground />
        <Controls />
      </ReactFlow>
    </ReactFlowProvider>
  );
}

export default function BuilderPage() {
  const { campaignId } = useLocalSearchParams<{ campaignId: string }>();
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [mailboxes, setMailboxes] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [editingNode, setEditingNode] = useState<{ id: string; type: string; data: any } | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [initialFlowData, setInitialFlowData] = useState<{ nodes: any[]; edges: any[] } | null>(null);
  const hasLoadedFlowRef = useRef(false);

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
        const [data, mailboxList] = await Promise.all([
          getCampaignById(campaignId),
          getCampaignMailboxes(campaignId),
        ]);
        setCampaign(data);
        setMailboxes(mailboxList || []);
        
        // Extract and parse flow_data
        if (data?.flow_data && !hasLoadedFlowRef.current) {
          try {
            const flowData = typeof data.flow_data === 'string' 
              ? JSON.parse(data.flow_data) 
              : data.flow_data;
            
            if (flowData && typeof flowData === 'object') {
              const nodes = Array.isArray(flowData.nodes) ? flowData.nodes : [];
              const edges = Array.isArray(flowData.edges) ? flowData.edges : [];
              setInitialFlowData({ nodes, edges });
              hasLoadedFlowRef.current = true;
            }
          } catch (error) {
            console.error('Failed to parse flow_data:', error);
            // Fallback to empty flow
            setInitialFlowData({ nodes: [], edges: [] });
            hasLoadedFlowRef.current = true;
          }
        } else if (!data?.flow_data && !hasLoadedFlowRef.current) {
          // No flow_data exists, start with empty
          setInitialFlowData({ nodes: [], edges: [] });
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
      
      setSaveStatus('saving');
      try {
        await updateCampaign(campaignId, {
          flow_data: { nodes, edges } as any,
        });
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
    // Call the stored function to add node
    if ((window as any).__reactFlowAddNode) {
      (window as any).__reactFlowAddNode(nodeType);
    }
  };

  const handleEditNode = (nodeId: string, nodeType: string) => {
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

    // Update the node data in React Flow
    if ((window as any).__reactFlowSetNodes) {
      const setNodes = (window as any).__reactFlowSetNodes;
      setNodes((nds: any[]) => 
        nds.map((node: any) => 
          node.id === editingNode.id
            ? { ...node, data: { ...node.data, ...updatedData } }
            : node
        )
      );
    }

    setEditingNode(null);
  };

  const handleCloseModal = () => {
    setEditingNode(null);
  };

  const nameSet = !!(campaign?.name?.trim());
  const flowBuilt = hasFlowBuilt(campaign);
  const scheduleSet = true;
  const mailboxesAdded = mailboxes.length >= 1;
  const isDraft = campaign?.status === 'draft' || (campaign != null && campaign.status !== 'running' && campaign.status !== 'paused' && campaign.status !== 'stopped');
  const canStart = isDraft && nameSet && flowBuilt && scheduleSet && mailboxesAdded;
  const showProgressBar = !isLoading && campaign && campaign.status !== 'running' && campaign.status !== 'paused' && campaign.status !== 'stopped';

  const steps = [
    { label: 'Name', done: nameSet },
    { label: 'Flow', done: flowBuilt },
    { label: 'Schedule', done: scheduleSet, onPress: () => campaignId && router.push({ pathname: '/campaigns/[id]/setup', params: { id: campaignId } }) },
    { label: 'Mailboxes', done: mailboxesAdded, onPress: () => campaignId && router.push({ pathname: '/campaigns/[id]/setup', params: { id: campaignId } }) },
  ];

  const handleStartCampaign = async () => {
    if (!campaignId || !canStart) return;
    setIsStarting(true);
    try {
      await updateCampaign(campaignId, { status: 'running' });
      const data = await getCampaignById(campaignId);
      setCampaign(data);
    } catch (err) {
      console.error('Error starting campaign:', err);
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <View className="flex-1 bg-[#121212] flex-row">
      <NavBar />
      
      {/* Main Content Area - React Flow */}
      <View className="flex-1 relative">
        {/* Header: breadcrumb + progress strip (draft) */}
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
                  label: isLoading ? 'Loading...' : (campaign?.name || 'Campaign Builder'),
                  href: campaignId ? `/campaigns/${campaignId}` : undefined,
                },
              ]}
            />
            {/* Save Status Indicator */}
            {saveStatus !== 'idle' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {saveStatus === 'saving' && (
                  <>
                    <View 
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: '#FBBF24',
                      }}
                    />
                    <Text className="text-gray-400 font-instrument text-sm">Saving...</Text>
                  </>
                )}
                {saveStatus === 'saved' && (
                  <>
                    <View 
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: '#F3440D',
                    }}
                    />
                    <Text className="text-gray-400 font-instrument text-sm">Saved</Text>
                  </>
                )}
                {saveStatus === 'error' && (
                  <>
                    <View 
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: '#EF4444',
                      }}
                    />
                    <Text className="text-red-400 font-instrument text-sm">Save failed</Text>
                  </>
                )}
              </View>
            )}
          </View>

          {/* Progress bar (draft only) */}
          {showProgressBar && (
            <View style={{ paddingHorizontal: 24, paddingBottom: 16 }}>
              <View style={{ flexDirection: 'row', marginBottom: 8 }}>
                {steps.map((step, i) => (
                  <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                    {step.onPress ? (
                      <Pressable onPress={step.onPress}>
                        <Text className="font-instrument text-xs text-gray-400">
                          {step.label}
                        </Text>
                      </Pressable>
                    ) : (
                      <Text className="font-instrument text-xs text-gray-400">
                        {step.label}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
              <View style={{ height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: '#2A2A2A' }}>
                <View
                  style={{
                    height: '100%',
                    width: `${(steps.filter((s) => s.done).length / steps.length) * 100}%`,
                    backgroundColor: '#F3440D',
                    borderTopLeftRadius: 3,
                    borderBottomLeftRadius: 3,
                  }}
                />
              </View>
              {canStart && (
                <View style={{ marginTop: 12, alignSelf: 'flex-start' }}>
                  <Button
                    onPress={handleStartCampaign}
                    disabled={isStarting}
                  >
                    {isStarting ? 'Starting...' : 'Start campaign'}
                  </Button>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Flow Editor */}
        <View 
          style={{ 
            flex: 1,
            position: 'relative',
            backgroundColor: 'transparent'
          }}
        >
          {initialFlowData !== null ? (
            <FlowEditor 
              onEditNode={handleEditNode}
              initialNodes={initialFlowData.nodes}
              initialEdges={initialFlowData.edges}
              onFlowChange={handleFlowChange}
            />
          ) : (
            <View className="flex-1 items-center justify-center">
              <Text className="text-gray-400 font-instrument">Loading flow...</Text>
            </View>
          )}
          {/* Floating Configure & launch button - bottom right */}
          {campaignId && (
            <Pressable
              onPress={() => router.push({ pathname: '/campaigns/[id]/setup', params: { id: campaignId } })}
              style={{
                position: 'absolute',
                right: 24,
                bottom: 24,
                backgroundColor: '#f85102',
                paddingHorizontal: 20,
                paddingVertical: 14,
                borderRadius: 12,
                zIndex: 10,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.25,
                shadowRadius: 4,
                elevation: 4,
              }}
            >
              <Text className="text-white font-instrument-semibold text-sm">
                Configure & launch
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
          const nodes =
            typeof window !== 'undefined' && (window as any).__reactFlowGetNodes
              ? (window as any).__reactFlowGetNodes()
              : [];
          const leadSourceNodes = (nodes as any[]).filter(
            (n: any) => n.type === 'leadSource'
          );
          const customFieldKeys = Array.from(
            new Set(
              leadSourceNodes.flatMap(
                (n: any) => n.data?.customFieldKeys ?? []
              )
            )
          );
          const mappedStandardFieldKeys = Array.from(
            new Set(
              leadSourceNodes.flatMap(
                (n: any) => n.data?.mappedStandardFieldKeys ?? []
              )
            )
          );
          modalData = {
            ...editingNode.data,
            campaignId: campaignId,
            customFieldKeys,
            mappedStandardFieldKeys:
              mappedStandardFieldKeys.length > 0
                ? mappedStandardFieldKeys
                : undefined,
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
    </View>
  );
}
