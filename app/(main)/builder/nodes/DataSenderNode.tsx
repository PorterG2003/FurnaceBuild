import { BaseNode } from './BaseNode';
import { nodeIcons } from './nodeMetadata';

interface DataSenderNodeData {
  label?: string;
  endpoint?: string;
  endpoint_url?: string;
  payload?: string;
  on_failure?: 'continue' | 'stop';
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
  
  return (
    <BaseNode label={displayLabel} onEdit={handleEdit} icon={IconComponent && <IconComponent size={16} color="#f85102" />}>
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

