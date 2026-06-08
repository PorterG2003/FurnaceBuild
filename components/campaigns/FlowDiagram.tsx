import { useMemo } from 'react';
import { View, Text, Platform } from 'react-native';
import { FlowCanvas, isReactFlowWebAvailable } from '@/lib/flow';
import { nodeTypes } from '@/app/(main)/builder/nodes/nodeTypes';

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
  if (!isReactFlowWebAvailable() || Platform.OS !== 'web') {
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

  // Ensure every node has a valid position so React Flow never reads undefined.x/undefined.y
  const safeNodes = useMemo(() => {
    return nodes.map((node: any, index: number) => {
      const pos = node.position;
      const x = typeof pos?.x === 'number' ? pos.x : index * 200;
      const y = typeof pos?.y === 'number' ? pos.y : 0;
      return {
        ...node,
        data: { ...node.data, readOnly: true },
        position: { x, y },
      };
    });
  }, [nodes]);

  const diagramHeight = height || 400;
  return (
    <View
      className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl"
      style={{ height: diagramHeight, padding: 0, overflow: 'hidden', borderRadius: 12 }}
    >
      <FlowCanvas
        mode="readonly"
        nodes={safeNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
      />
    </View>
  );
}
