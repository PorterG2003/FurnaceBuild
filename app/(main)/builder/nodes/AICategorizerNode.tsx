import { Fragment, useState } from 'react';
import { Handle } from './HandleWrapper';
import { nodeIcons } from './nodeMetadata';
import { FlowNodeActionsMenu } from '../components/FlowNodeActionsMenu';

/**
 * Categorizer node (node_type stays 'aiCategorizer'): waits for a reply,
 * categorizes it (AI or manual via Master Inbox), and branches on one of
 * three fixed outputs. Handle ids must match the scheduler's
 * CATEGORY_SOURCE_HANDLES (ai-categorizer-handler.ts).
 */
const BRANCHES = [
  { id: 'not-interested', label: 'Not Interested', color: '#EA580C', pillBg: '#3A2314' },
  { id: 'neutral', label: 'Neutral', color: '#94A3B8', pillBg: '#2C3440' },
  { id: 'interested', label: 'Interested', color: '#34D399', pillBg: '#1A3530' },
] as const;

interface AICategorizerNodeData {
  label?: string;
  use_ai?: boolean;
  readOnly?: boolean;
  canDelete?: boolean;
  structuralBlocked?: boolean;
}

interface AICategorizerNodeProps {
  data: AICategorizerNodeData;
  selected?: boolean;
  id?: string;
}

export function AICategorizerNode({ data, selected, id }: AICategorizerNodeProps) {
  if (!Handle) return null;

  const [isHovered, setIsHovered] = useState(false);
  const [hoveredBranchId, setHoveredBranchId] = useState<string | null>(null);
  const displayLabel = data.label || 'Categorizer';
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
        minWidth: '260px',
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
            onDelete={data.canDelete !== false ? handleDelete : undefined}
            deleteMuted={!!data.structuralBlocked}
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
        marginBottom: '4px',
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
        <span
          style={{
            fontSize: '10px',
            fontWeight: '600',
            padding: '2px 6px',
            borderRadius: '6px',
            backgroundColor: data.use_ai ? 'rgba(248, 81, 2, 0.18)' : '#2A2A2A',
            color: data.use_ai ? '#f85102' : '#9CA3AF',
            border: `1px solid ${data.use_ai ? 'rgba(248, 81, 2, 0.4)' : '#3A3A3A'}`,
          }}
        >
          {data.use_ai ? 'AI' : 'Manual'}
        </span>
      </div>

      {BRANCHES.map((branch, index) => {
        const handleLeft = `${(index + 0.5) * (100 / BRANCHES.length)}%`;

        return (
          <Fragment key={branch.id}>
            {hoveredBranchId === branch.id ? (
              <div
                style={{
                  position: 'absolute',
                  bottom: '8px',
                  left: handleLeft,
                  transform: 'translateX(-50%)',
                  pointerEvents: 'none',
                  zIndex: 20,
                  backgroundColor: branch.pillBg,
                  border: `1px solid ${branch.color}`,
                  borderRadius: '4px',
                  padding: '1px 5px',
                  color: branch.color,
                  fontSize: '8px',
                  fontWeight: '400',
                  lineHeight: '12px',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
                }}
              >
                {branch.label}
              </div>
            ) : null}
            <Handle
              type="source"
              position="bottom"
              id={branch.id}
              onMouseEnter={() => setHoveredBranchId(branch.id)}
              onMouseLeave={() => setHoveredBranchId(null)}
              style={{
                background: branch.color,
                border: '2px solid #1A1A1A',
                width: 10,
                height: 10,
                left: handleLeft,
              }}
            />
          </Fragment>
        );
      })}
    </div>
  );
}

export default AICategorizerNode;
