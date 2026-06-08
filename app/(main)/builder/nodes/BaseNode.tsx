import { useState } from 'react';
import { Handle } from './HandleWrapper';
import { FlowNodeActionsMenu } from '../components/FlowNodeActionsMenu';

interface BaseNodeProps {
  label: string;
  handles?: {
    source?: boolean;
    target?: boolean;
  };
  children?: React.ReactNode;
  borderColor?: string;
  onEdit?: () => void;
  onDelete?: () => void;
  icon?: React.ReactNode;
  showActions?: boolean;
  canDelete?: boolean;
  nodeLabel?: string;
}

function BaseNode({ 
  label, 
  handles = { source: true, target: true },
  children,
  borderColor = '#2A2A2A',
  onEdit,
  onDelete,
  icon,
  showActions = true,
  canDelete = true,
  nodeLabel,
}: BaseNodeProps) {
  if (!Handle) return null;
  
  const [isHovered, setIsHovered] = useState(false);
  
  // Determine hover border color - brighter version of borderColor
  const hoverBorderColor = isHovered 
    ? borderColor === '#2A2A2A' 
      ? '#F3440D' 
      : borderColor === '#F3440D'
      ? '#FF6B35'
      : borderColor
    : borderColor;
  
  return (
    <div 
      style={{
        background: '#1A1A1A',
        backgroundColor: '#1A1A1A',
        border: `2px solid ${hoverBorderColor}`,
        borderRadius: '12px',
        padding: '12px 16px',
        minWidth: '140px',
        boxShadow: isHovered 
          ? '0 4px 12px rgba(248, 81, 2, 0.2)' 
          : '0 2px 8px rgba(0, 0, 0, 0.3)',
        fontFamily: 'Instrument Sans, system-ui, sans-serif',
        position: 'relative',
        overflow: 'visible',
        cursor: onEdit ? 'pointer' : 'default',
        transition: 'all 0.2s ease',
        transform: isHovered ? 'scale(1.02)' : 'scale(1)',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {showActions && isHovered && onEdit ? (
        <div
          style={{
            position: 'absolute',
            top: -8,
            right: -8,
            zIndex: 1000,
          }}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <FlowNodeActionsMenu
            onEdit={onEdit}
            onDelete={canDelete ? onDelete : undefined}
            label={nodeLabel || label}
          />
        </div>
      ) : null}

      {handles.target && (
        <Handle
          type="target"
          position="top"
          style={{
            background: '#F3440D',
            border: '2px solid #1A1A1A',
            width: 10,
            height: 10,
          }}
        />
      )}
      
      <div style={{ 
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        marginBottom: children ? '8px' : '0',
        color: '#FFFFFF',
        fontSize: '14px',
        fontWeight: '600',
      }}>
        {icon && (
          <div style={{ display: 'flex', alignItems: 'center', color: '#f85102' }}>
            {icon}
          </div>
        )}
        <span>{label}</span>
      </div>
      
      {children && (
        <div style={{ marginTop: '8px' }}>
          {children}
        </div>
      )}
      
      {handles.source && (
        <Handle
          type="source"
          position="bottom"
          style={{
            background: '#F3440D',
            border: '2px solid #1A1A1A',
            width: 10,
            height: 10,
          }}
        />
      )}
    </div>
  );
}

export { BaseNode };
export default BaseNode;

