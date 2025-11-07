import { useState } from 'react';
import { Handle } from './HandleWrapper';
import { nodeIcons } from './nodeMetadata';

interface AICategorizerNodeData {
  label?: string;
  categories?: string[];
}

interface AICategorizerNodeProps {
  data: AICategorizerNodeData;
  selected?: boolean;
  id?: string;
}

// Simple pencil icon SVG
const PencilIcon = ({ size = 16, color = '#ffffff' }: { size?: number; color?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </svg>
);

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
      {/* Edit Button - Top Right Corner */}
      {isHovered && handleEdit && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleEdit();
          }}
          style={{
            position: 'absolute',
            top: '-8px',
            right: '-8px',
            width: '24px',
            height: '24px',
            backgroundColor: 'rgba(42, 42, 42, 0.95)',
            border: '1px solid #3A3A3A',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: 0,
            zIndex: 1000,
            transition: 'all 0.15s ease',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(42, 42, 42, 1)';
            e.currentTarget.style.borderColor = '#4A4A4A';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(42, 42, 42, 0.95)';
            e.currentTarget.style.borderColor = '#3A3A3A';
          }}
        >
          <PencilIcon size={12} color="#f85102" />
        </button>
      )}
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

