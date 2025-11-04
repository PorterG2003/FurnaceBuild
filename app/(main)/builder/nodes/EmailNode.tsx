import { BaseNode } from './BaseNode';
import { nodeIcons } from './nodeTypes';

interface EmailNodeData {
  label?: string;
  subject?: string;
  template?: string;
  recipients?: string[];
}

interface EmailNodeProps {
  data: EmailNodeData;
  selected?: boolean;
  id?: string;
}

export function EmailNode({ data, selected, id }: EmailNodeProps) {
  const displayLabel = data.label || 'Send Email';
  const IconComponent = nodeIcons.email;
  
  const handleEdit = () => {
    // Trigger modal - will be handled by parent component
    if (typeof window !== 'undefined') {
      (window as any).__reactFlowEditNode?.(id, 'email');
    }
  };
  
  return (
    <BaseNode label={displayLabel} onEdit={handleEdit} icon={IconComponent && <IconComponent size={16} color="#f85102" />}>
      {data.subject && (
        <div style={{
          color: '#9CA3AF',
          fontSize: '12px',
          textAlign: 'center',
          fontFamily: 'Instrument Sans, system-ui, sans-serif',
        }}>
          {data.subject}
        </div>
      )}
    </BaseNode>
  );
}

