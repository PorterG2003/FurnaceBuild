import { BaseNode } from './BaseNode';
import { nodeIcons } from './nodeMetadata';

interface DataSenderNodeData {
  label?: string;
  endpoint?: string;
  endpoint_url?: string;
  payload?: string;
  on_failure?: 'continue' | 'stop';
  readOnly?: boolean;
  canDelete?: boolean;
  structuralBlocked?: boolean;
}

interface DataSenderNodeProps {
  data: DataSenderNodeData;
  selected?: boolean;
  id?: string;
}

function DataSenderNode({ data, selected, id }: DataSenderNodeProps) {
  const displayLabel = data.label || 'Data Sender';
  const IconComponent = nodeIcons.dataSender;
  const endpoint = data.endpoint_url || data.endpoint;
  
  const handleEdit = () => {
    if (typeof window !== 'undefined') {
      (window as any).__reactFlowEditNode?.(id, 'dataSender');
    }
  };

  const handleDelete = () => {
    if (typeof window !== 'undefined') {
      (window as any).__reactFlowDeleteNode?.(id);
    }
  };
  
  return (
    <BaseNode
      label={displayLabel}
      onEdit={handleEdit}
      onDelete={handleDelete}
      icon={IconComponent && <IconComponent size={16} color="#f85102" />}
      showActions={!data.readOnly}
      canDelete={data.canDelete !== false}
      deleteMuted={!!data.structuralBlocked}
      nodeLabel={displayLabel}
    >
      {endpoint && (
        <div style={{
          color: '#9CA3AF',
          fontSize: '12px',
          textAlign: 'center',
          fontFamily: 'Instrument Sans, system-ui, sans-serif',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {endpoint}
        </div>
      )}
    </BaseNode>
  );
}

export { DataSenderNode };
export default DataSenderNode;

