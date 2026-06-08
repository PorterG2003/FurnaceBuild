import { useState } from 'react';
import { TrashIcon } from 'react-native-heroicons/outline';
import { EdgeLabelRenderer, getBezierPath } from '@/lib/flow';

const BTN = 12;
const INSET = 2;
const CONTAINER_H = BTN + INSET * 2;

const pillStyle: React.CSSProperties = {
  background: '#2A2A2A',
  border: '1px solid #3A3A3A',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: CONTAINER_H,
  height: CONTAINER_H,
  borderRadius: CONTAINER_H / 2,
};

const btnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  margin: 0,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '50%',
  lineHeight: 0,
  width: BTN,
  height: BTN,
};

interface DeletableFlowEdgeProps {
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: any;
  targetPosition: any;
  selected?: boolean;
}

export function DeletableFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
}: DeletableFlowEdgeProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isActive = isHovered || selected;

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (typeof window !== 'undefined') {
      (window as any).__reactFlowDeleteEdge?.(id);
    }
  };

  return (
    <>
      <g
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <path
          d={edgePath}
          fill="none"
          stroke="transparent"
          strokeWidth={24}
          pointerEvents="stroke"
        />
        <path
          d={edgePath}
          fill="none"
          pointerEvents="none"
          className={`react-flow__edge-path${isActive ? ' furnace-flow-edge-path--active' : ''}`}
        />
      </g>
      <EdgeLabelRenderer>
        <div
          className={`nodrag nopan furnace-edge-delete-btn${isActive ? ' furnace-edge-delete-btn--visible' : ''}`}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div style={pillStyle}>
            <button
              type="button"
              className="nodrag nopan"
              style={btnStyle}
              onClick={handleDelete}
              onMouseEnter={(event) => {
                (event.currentTarget as HTMLButtonElement).style.background =
                  'rgba(248,113,113,0.18)';
              }}
              onMouseLeave={(event) => {
                (event.currentTarget as HTMLButtonElement).style.background = 'none';
              }}
              title="Delete connection"
            >
              <TrashIcon size={10} color="#F87171" />
            </button>
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export default DeletableFlowEdge;
