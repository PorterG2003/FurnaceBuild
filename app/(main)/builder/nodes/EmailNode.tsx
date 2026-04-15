import { BaseNode } from './BaseNode';
import { nodeIcons } from './nodeMetadata';

interface EmailVariant {
  id?: string;
  label?: string;
  subject?: string;
  template?: string;
  isActive?: boolean;
}

interface EmailNodeData {
  label?: string;
  subject?: string;
  template?: string;
  mailboxId?: string;
  variants?: EmailVariant[];
}

interface EmailNodeProps {
  data: EmailNodeData;
  selected?: boolean;
  id?: string;
}

function EmailNode({ data, selected, id }: EmailNodeProps) {
  const displayLabel = data.label || 'Send Email';
  const previewSubject =
    data.variants && data.variants.length > 0
      ? (data.variants.find((v) => v.isActive !== false) ?? data.variants[0])?.subject
      : data.subject;
  const IconComponent = nodeIcons.email;
  
  const handleEdit = () => {
    // Trigger modal - will be handled by parent component
    if (typeof window !== 'undefined') {
      (window as any).__reactFlowEditNode?.(id, 'email');
    }
  };
  
  return (
    <BaseNode label={displayLabel} onEdit={handleEdit} icon={IconComponent && <IconComponent size={16} color="#f85102" />}>
      {previewSubject ? (
        <div style={{
          color: '#9CA3AF',
          fontSize: '12px',
          textAlign: 'center',
          fontFamily: 'Instrument Sans, system-ui, sans-serif',
        }}>
          {previewSubject}
        </div>
      ) : null}
    </BaseNode>
  );
}

export { EmailNode };
export default EmailNode;

