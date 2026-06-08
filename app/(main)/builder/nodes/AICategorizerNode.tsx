import { useState } from 'react';
import { Handle } from './HandleWrapper';
import { nodeIcons } from './nodeMetadata';
import { FlowNodeActionsMenu } from '../components/FlowNodeActionsMenu';

interface AICategorizerNodeData {
  label?: string;
  categories?: string[];
  readOnly?: boolean;
}

interface AICategorizerNodeProps {
  data: AICategorizerNodeData;
  selected?: boolean;
  id?: string;
}

export function AICategorizerNode({ data, selected, id }: AICategorizerNodeProps) {
  if (!Handle) return null;
  
  const [isHovered, setIsHovered] = useState(false);
  const displayLabel = data.label || 'AI Categorizer';
  const categories = data.categories || [];
  const IconComponent = nodeIcons.aiCategorizer;
  
  const handleEdit = () => {
    if (typeof window !== 'undefined') {
      (window as any).__reactFlowEditNode?.(id, 'aiCategorizer');
    }
  };

  const handleDelete = () => {
    if (typeof window !== 'undefined') {
      (window as any).__reactFlowDeleteNode?.(id);
    }
  };
  
  return (
    <div 
      style={{
        background: '#1A1A1A',
        backgroundColor: '#1A1A1A',
        border: '2px solid #2A2A2A',
        borderRadius: '12px',
        padding: '12px 16px',
        minWidth: '160px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
        fontFamily: 'Instrument Sans, system-ui, sans-serif',
        position: 'relative',
        overflow: 'visible',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {isHovered && !data.readOnly ? (
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
            onEdit={handleEdit}
            onDelete={handleDelete}
            label={displayLabel}
          />
        </div>
      ) : null}

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
      
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        marginBottom: categories.length > 0 ? '8px' : '0',
        color: '#FFFFFF',
        fontSize: '14px',
        fontWeight: '600',
      }}>
        {IconComponent && (
          <div style={{ display: 'flex', alignItems: 'center', color: '#f85102' }}>
            <IconComponent size={16} color="#f85102" />
          </div>
        )}
        <span>{displayLabel}</span>
      </div>
      
      {categories.length > 0 && (
        <div style={{ marginTop: '8px' }}>
          {categories.map((category, index) => (
            <div key={index} style={{ marginBottom: '4px' }}>
              <div style={{
                color: '#9CA3AF',
                fontSize: '12px',
                textAlign: 'center',
                fontFamily: 'Instrument Sans, system-ui, sans-serif',
              }}>
                {category}
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* Multiple source handles for categories */}
      {categories.length > 0 ? (
        categories.map((_, index) => (
          <Handle
            key={index}
            type="source"
            position="bottom"
            id={`category-${index}`}
            style={{
              background: '#F3440D',
              border: '2px solid #1A1A1A',
              width: 10,
              height: 10,
              left: `${(index + 1) * (100 / (categories.length + 1))}%`,
            }}
          />
        ))
      ) : (
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

export default AICategorizerNode;

