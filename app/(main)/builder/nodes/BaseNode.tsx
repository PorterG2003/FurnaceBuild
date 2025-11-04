import { useState } from 'react';
import { Handle } from './HandleWrapper';

interface BaseNodeProps {
  label: string;
  handles?: {
    source?: boolean;
    target?: boolean;
  };
  children?: React.ReactNode;
  borderColor?: string;
  onEdit?: () => void;
  icon?: React.ReactNode;
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

export function BaseNode({ 
  label, 
  handles = { source: true, target: true },
  children,
  borderColor = '#2A2A2A',
  onEdit,
  icon
}: BaseNodeProps) {
  if (!Handle) return null;
  
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <div 
      style={{
        background: '#1A1A1A',
        backgroundColor: '#1A1A1A',
        border: `2px solid ${borderColor}`,
        borderRadius: '12px',
        padding: '12px 16px',
        minWidth: '140px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
        fontFamily: 'Instrument Sans, system-ui, sans-serif',
        position: 'relative',
        overflow: 'visible',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Edit Button - Top Right Corner */}
      {isHovered && onEdit && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
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

