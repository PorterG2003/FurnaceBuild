import { BaseNode } from './BaseNode';
import { nodeIcons } from './nodeTypes';

interface DataSenderNodeData {
  label?: string;
  endpoint?: string;
  payload?: string;
}

interface DataSenderNodeProps {
  data: DataSenderNodeData;
  selected?: boolean;
  id?: string;
}

export function DataSenderNode({ data, selected, id }: DataSenderNodeProps) {
  const displayLabel = data.label || 'Data Sender';
  const IconComponent = nodeIcons.dataSender;
  
  const handleEdit = () => {
    if (typeof window !== 'undefined') {
      (window as any).__reactFlowEditNode?.(id, 'dataSender');
    }
  };
  
  return (
    <BaseNode label={displayLabel} onEdit={handleEdit} icon={IconComponent && <IconComponent size={16} color="#f85102" />}>
      {data.endpoint && (
        <div style={{
          color: '#9CA3AF',
          fontSize: '12px',
          textAlign: 'center',
          fontFamily: 'Instrument Sans, system-ui, sans-serif',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {data.endpoint}
        </div>
      )}
    </BaseNode>
  );
}

