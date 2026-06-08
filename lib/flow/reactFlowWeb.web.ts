/**
 * Load @xyflow/react via require so Metro uses the UMD build.
 * Static ESM imports pull zustand's .mjs files which use import.meta
 * and crash in the Expo web bundle.
 */
require('@xyflow/react/dist/style.css');

const ReactFlowModule = require('@xyflow/react');

export const ReactFlow = ReactFlowModule.default || ReactFlowModule.ReactFlow;
export const ReactFlowProvider = ReactFlowModule.ReactFlowProvider;
export const Controls = ReactFlowModule.Controls;
export const addEdge = ReactFlowModule.addEdge;
export const useNodesState = ReactFlowModule.useNodesState;
export const useEdgesState = ReactFlowModule.useEdgesState;
export const useStore = ReactFlowModule.useStore;
export const BaseEdge = ReactFlowModule.BaseEdge;
export const EdgeLabelRenderer = ReactFlowModule.EdgeLabelRenderer;
export const getBezierPath = ReactFlowModule.getBezierPath;
