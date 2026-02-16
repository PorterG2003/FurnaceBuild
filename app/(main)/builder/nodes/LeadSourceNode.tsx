import { BaseNode } from './BaseNode';
import { nodeIcons } from './nodeMetadata';

interface LeadSourceNodeData {
  label?: string;
  source?: string;
  customFieldKeys?: string[];
  mappedStandardFieldKeys?: string[];
}

interface LeadSourceNodeProps {
  data: LeadSourceNodeData;
  selected?: boolean;
  id?: string;
}

function LeadSourceNode({ data, selected, id }: LeadSourceNodeProps) {
  const displayLabel = data.label || 'Lead Bucket';
  const IconComponent = nodeIcons.leadSource;
  
  const handleEdit = () => {
    if (typeof window !== 'undefined') {
      (window as any).__reactFlowEditNode?.(id, 'leadSource');
    }
  };
  
  return (
    <BaseNode label={displayLabel} borderColor="#F3440D" onEdit={handleEdit} icon={IconComponent && <IconComponent size={16} color="#f85102" />}>
      {data.source && (
        <div style={{
          color: '#9CA3AF',
          fontSize: '12px',
          textAlign: 'center',
          fontFamily: 'Instrument Sans, system-ui, sans-serif',
        }}>
          {data.source}
        </div>
      )}
    </BaseNode>
  );
}

export { LeadSourceNode };
export default LeadSourceNode;

