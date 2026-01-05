import { View, Text, Platform } from 'react-native';

// Conditionally import React Flow only on web
let ReactFlow: any = null;
let ReactFlowProvider: any = null;
let FlowBackground: any = null;

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  try {
    // Import CSS
    require('@xyflow/react/dist/style.css');
    
    // Dynamic require for React Flow
    const ReactFlowModule = require('@xyflow/react');
    ReactFlow = ReactFlowModule.default || ReactFlowModule.ReactFlow;
    ReactFlowProvider = ReactFlowModule.ReactFlowProvider;
    FlowBackground = ReactFlowModule.Background;
  } catch (error) {
    console.error('Failed to load React Flow:', error);
  }
}

// Import node types from builder
let nodeTypes: any = {};
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  try {
    const builderNodeTypes = require('@/app/(main)/builder/nodes/nodeTypes');
    nodeTypes = builderNodeTypes.nodeTypes || {};
  } catch (error) {
    console.error('Failed to load node types:', error);
  }
}

interface FlowDiagramProps {
  nodes: any[];
  edges: any[];
}

/**
 * Read-only React Flow diagram component
 * Displays a flow diagram without any interaction (no drag, zoom, pan, etc.)
 */
export function FlowDiagram({ nodes, edges }: FlowDiagramProps) {
  if (!ReactFlow || !ReactFlowProvider || Platform.OS !== 'web') {
    return (
      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6" style={{ minHeight: 400 }}>
        <Text className="text-gray-400 font-instrument text-sm text-center">
          Flow diagram not available on this platform
        </Text>
      </View>
    );
  }

  if (!nodes || nodes.length === 0) {
    return (
      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6" style={{ minHeight: 400 }}>
        <Text className="text-gray-400 font-instrument text-sm text-center">
          No flow diagram available
        </Text>
      </View>
    );
  }

  return (
    <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6" style={{ height: 500 }}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          selectNodesOnDrag={false}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          style={{ width: '100%', height: '100%' }}
        >
          <FlowBackground />
        </ReactFlow>
      </ReactFlowProvider>
    </View>
  );
}

