import { FlowDotBackground } from './FlowDotBackground.web';
import type { FlowCanvasProps } from './flowCanvasTypes';
import { FLOW_CANVAS_BG, FLOW_PREVIEW_CANVAS_BG } from './flowTheme';
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
} from './reactFlowWeb.web';

export {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
};

export type { FlowCanvasMode, FlowCanvasProps } from './flowCanvasTypes';

export function isReactFlowWebAvailable() {
  return true;
}

export function FlowCanvas({
  mode,
  nodes,
  edges,
  nodeTypes,
  edgeTypes,
  defaultEdgeOptions,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeClick,
  onInit,
  fitView,
  fitViewOptions,
  deleteKeyCode = null,
  style,
  children,
}: FlowCanvasProps) {
  const readonly = mode === 'readonly';
  const canvasBackgroundColor = readonly ? FLOW_PREVIEW_CANVAS_BG : FLOW_CANVAS_BG;
  const canvasClassName = readonly
    ? 'dark furnace-flow-canvas furnace-flow-canvas--contained'
    : 'dark furnace-flow-canvas';

  return (
    <ReactFlowProvider>
      <ReactFlow
        className={canvasClassName}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onInit={onInit}
        fitView={fitView}
        fitViewOptions={fitViewOptions}
        deleteKeyCode={deleteKeyCode}
        nodesDraggable={!readonly}
        nodesConnectable={!readonly}
        elementsSelectable={!readonly}
        panOnDrag={!readonly}
        preventScrolling={!readonly}
        zoomOnScroll={!readonly}
        zoomOnPinch={!readonly}
        zoomOnDoubleClick={!readonly}
        selectNodesOnDrag={!readonly}
        style={{ width: '100%', height: '100%', ...style }}
      >
        <FlowDotBackground backgroundColor={canvasBackgroundColor} />
        {children}
      </ReactFlow>
    </ReactFlowProvider>
  );
}
