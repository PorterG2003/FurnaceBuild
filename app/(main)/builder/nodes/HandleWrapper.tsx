// Wrapper for Handle that works with conditional React Flow loading
// This allows nodes to use Handle even when React Flow is conditionally loaded

let Handle: any = null;

if (typeof window !== 'undefined') {
  try {
    const ReactFlowModule = require('@xyflow/react');
    Handle = ReactFlowModule.Handle;
  } catch (error) {
    // Handle not available
  }
}

export { Handle };
export default function HandleWrapper() {
  return null;
}

