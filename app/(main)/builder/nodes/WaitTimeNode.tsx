import { BaseNode } from './BaseNode';
import { nodeIcons } from './nodeMetadata';

interface WaitTimeNodeData {
  label?: string;
  duration?: string;
  unit?: 'minutes' | 'hours' | 'days';
}

interface WaitTimeNodeProps {
  data: WaitTimeNodeData;
  selected?: boolean;
  id?: string;
}

function WaitTimeNode({ data, selected, id }: WaitTimeNodeProps) {
  const displayLabel = data.label || 'Wait Time';
  const IconComponent = nodeIcons.waitTime;
  
  const displayDuration = data.duration && data.unit 
    ? `${data.duration} ${data.unit}`
    : null;
  
  const handleEdit = () => {
    if (typeof window !== 'undefined') {
      (window as any).__reactFlowEditNode?.(id, 'waitTime');
    }
  };
  
  return (
    <BaseNode label={displayLabel} onEdit={handleEdit} icon={IconComponent && <IconComponent size={16} color="#f85102" />}>
      {displayDuration && (
        <div style={{
          color: '#9CA3AF',
          fontSize: '12px',
          textAlign: 'center',
          fontFamily: 'Instrument Sans, system-ui, sans-serif',
        }}>
          {displayDuration}
        </div>
      )}
    </BaseNode>
  );
}

export { WaitTimeNode };
export default WaitTimeNode;

