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
  /** Height of the diagram container. When set, fitView will scale the flow to fit. Omit for default (400). */
  height?: number;
}

/**
 * Read-only React Flow diagram component
 * Displays a flow diagram without any interaction (no drag, zoom, pan, etc.)
 */
export function FlowDiagram({ nodes, edges, height = 400 }: FlowDiagramProps) {
  if (!ReactFlow || !ReactFlowProvider || Platform.OS !== 'web') {
    return (
      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6" style={{ minHeight: height || 400 }}>
        <Text className="text-gray-400 font-instrument text-sm text-center">
          Flow diagram not available on this platform
        </Text>
      </View>
    );
  }

  if (!nodes || nodes.length === 0) {
    return (
      <View
        className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-8"
        style={{
          minHeight: 280,
          alignItems: 'center',
          justifyContent: 'center',
          borderStyle: 'solid',
        }}
      >
        <View
          style={{
            borderWidth: 1,
            borderColor: '#2A2A2A',
            borderStyle: 'dashed',
            borderRadius: 12,
            paddingVertical: 32,
            paddingHorizontal: 24,
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            maxWidth: 320,
          }}
        >
          <Text
            className="text-gray-500 font-instrument text-4xl mb-3"
            style={{ opacity: 0.6 }}
          >
            ∿
          </Text>
          <Text className="text-white font-instrument-semibold text-base text-center mb-1">
            No flow yet
          </Text>
          <Text className="text-gray-500 font-instrument text-sm text-center">
            Edit the campaign flow in the builder to see it here.
          </Text>
        </View>
      </View>
    );
  }

  const diagramHeight = height || 400;
  return (
    <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl" style={{ height: diagramHeight, padding: 0 }}>
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
