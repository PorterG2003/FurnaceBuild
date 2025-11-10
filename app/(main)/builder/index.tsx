import { useEffect, useCallback, useState } from 'react';
import { View, Platform, Text } from 'react-native';
import { NavBar } from '@/components/ui/NavBar';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getCampaignById } from '@/lib/supabase/services/campaigns';
import type { Campaign } from '@/lib/supabase/types';
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

// Initial nodes - Lead Bucket will be added automatically if missing
const initialNodes: any[] = [];

// Initial edges - empty for now, users will connect nodes
const initialEdges: any[] = [];

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
}

function FlowEditor({ onEditNode }: FlowEditorProps) {
  if (!useNodesState || !useEdgesState || !addEdge || !ReactFlow || !ReactFlowProvider) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-white font-instrument">React Flow not available</Text>
      </View>
    );
  }

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

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

  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
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
  const [isLoading, setIsLoading] = useState(true);
  const [editingNode, setEditingNode] = useState<{ id: string; type: string; data: any } | null>(null);

  useEffect(() => {
    if (!campaignId) {
      router.replace('/campaigns');
    }
  }, [campaignId, router]);

  useEffect(() => {

    // Fetch campaign data
    const loadCampaign = async () => {
      if (!campaignId) return;
      
      setIsLoading(true);
      try {
        const data = await getCampaignById(campaignId);
        setCampaign(data);
      } catch (error) {
        console.error('Failed to load campaign:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadCampaign();
  }, [campaignId]);

  if (!campaignId) {
    return (
      <View className="flex-1 bg-[#121212] flex-row">
        <NavBar />
        <View className="flex-1 items-center justify-center">
          <Text className="text-gray-300 font-instrument">Redirecting…</Text>
        </View>
      </View>
    );
  }

  // React Flow only works on web
  if (Platform.OS !== 'web') {
    return (
      <View className="flex-1 bg-[#121212] flex-row">
        <NavBar />
        <View className="flex-1 relative bg-[#121212]">
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
        </View>
      </View>
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

  return (
    <View className="flex-1 bg-[#121212] flex-row">
      <NavBar />
      
      {/* Main Content Area - React Flow has its own background */}
      <View className="flex-1">
        {/* Header with Breadcrumb */}
        <View 
          style={{
            backgroundColor: '#121212',
            borderBottomWidth: 1,
            borderBottomColor: '#2A2A2A',
            paddingHorizontal: 24,
            paddingVertical: 16,
            zIndex: 10,
          }}
        >
          <Breadcrumb
            items={[
              { label: 'Campaigns', href: '/campaigns' },
              { 
                label: isLoading ? 'Loading...' : campaign?.name || 'Campaign Builder'
              },
            ]}
          />
        </View>

        {/* Flow Editor */}
        <View 
          style={{ 
            flex: 1,
            position: 'relative',
            backgroundColor: 'transparent'
          }}
        >
          <FlowEditor onEditNode={handleEditNode} />
        </View>
      </View>
      
      {/* Node Sidebar - Right side */}
      <NodeSidebar onAddNode={handleAddNode} />

      {/* Node Modal */}
      {editingNode && (() => {
        const ModalComponent = nodeModalRegistry[editingNode.type];
        if (!ModalComponent) return null;
        
        // For Lead Bucket node, pass campaign and bucket IDs
        const modalData = editingNode.type === 'leadSource' 
          ? {
              ...editingNode.data,
              campaignId: campaignId,
              bucketId: campaign?.bucket_id || editingNode.data?.bucketId,
            }
          : editingNode.data;
        
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
