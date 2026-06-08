import { useCallback, useEffect, useRef, useState } from 'react';
import { EllipsisHorizontalIcon, PencilSquareIcon, TrashIcon } from 'react-native-heroicons/outline';

const EXPAND_MS = 200;

// All spacing derived from a single value so x and y are consistent:
//   container height = BTN + 2*INSET
//   horizontal padding = INSET, gap between icons = INSET
const INSET = 3;
const BTN = 16; // button circle diameter
const CONTAINER_H = BTN + INSET * 2; // 22px

interface FlowNodeActionsMenuProps {
  onEdit: () => void;
  onDelete?: () => void;
}

const pillStyle: React.CSSProperties = {
  background: '#2A2A2A',
  border: '1px solid #3A3A3A',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
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
  flexShrink: 0,
  width: BTN,
  height: BTN,
};

function EditOnlyButton({ onEdit }: { onEdit: () => void }) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ ...pillStyle, width: CONTAINER_H, height: CONTAINER_H, borderRadius: CONTAINER_H / 2 }}
    >
      <button
        style={btnStyle}
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.12)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'none';
        }}
        title="Edit"
      >
        <PencilSquareIcon size={12} color="#9CA3AF" />
      </button>
    </div>
  );
}

export function FlowNodeActionsMenu({ onEdit, onDelete }: FlowNodeActionsMenuProps) {
  // Edit-only nodes: static circle with pencil, no expand needed
  if (!onDelete) {
    return <EditOnlyButton onEdit={onEdit} />;
  }

  return <ExpandingRail onEdit={onEdit} onDelete={onDelete} />;
}

function ExpandingRail({ onEdit, onDelete }: Required<FlowNodeActionsMenuProps>) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isInteractive, setIsInteractive] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const expand = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsExpanded(true);
    setIsInteractive(false);
    timerRef.current = setTimeout(() => setIsInteractive(true), EXPAND_MS);
  }, []);

  const collapse = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsExpanded(false);
    setIsInteractive(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // INSET (left) + BTN + INSET (gap) + BTN + INSET (right)
  const expandedWidth = INSET + BTN + INSET + BTN + INSET;

  return (
    <div
      onMouseEnter={expand}
      onMouseLeave={collapse}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        ...pillStyle,
        position: 'relative',
        width: isExpanded ? expandedWidth : CONTAINER_H,
        height: CONTAINER_H,
        borderRadius: CONTAINER_H / 2,
        transition: `width ${EXPAND_MS}ms ease-out`,
      }}
    >
      {/* Three dots — fades out when expanded */}
      <div
        style={{
          position: 'absolute',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: CONTAINER_H,
          height: CONTAINER_H,
          opacity: isExpanded ? 0 : 1,
          transition: `opacity ${EXPAND_MS * 0.3}ms ease-out`,
          pointerEvents: 'none',
        }}
      >
        <EllipsisHorizontalIcon size={14} color="#9CA3AF" />
      </div>

      {/* Action icons — fades in after expand */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: INSET,
          padding: `0 ${INSET}px`,
          pointerEvents: isInteractive ? 'auto' : 'none',
          opacity: isExpanded ? 1 : 0,
          transition: isExpanded
            ? `opacity ${EXPAND_MS * 0.5}ms ease-out ${EXPAND_MS * 0.5}ms`
            : `opacity ${EXPAND_MS * 0.3}ms ease-out`,
          whiteSpace: 'nowrap',
        }}
      >
        <button
          style={btnStyle}
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.12)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'none';
          }}
          title="Edit"
        >
          <PencilSquareIcon size={12} color="#9CA3AF" />
        </button>
        <button
          style={btnStyle}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(248,113,113,0.18)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'none';
          }}
          title="Delete"
        >
          <TrashIcon size={12} color="#F87171" />
        </button>
      </div>
    </div>
  );
}

export default FlowNodeActionsMenu;
