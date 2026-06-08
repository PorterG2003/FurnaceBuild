import { useStore } from './reactFlowWeb.web';
import {
  FLOW_DOT_COLOR,
  FLOW_DOT_GAP,
  FLOW_DOT_SIZE,
} from './flowTheme';

interface FlowDotBackgroundProps {
  backgroundColor: string;
}

export function FlowDotBackground({ backgroundColor }: FlowDotBackgroundProps) {
  const [x, y, zoom] = useStore((state: { transform: [number, number, number] }) => state.transform);
  const gap = FLOW_DOT_GAP * zoom;

  return (
    <div
      aria-hidden
      data-testid="furnace-flow-dot-background"
      className="furnace-flow-dot-background"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        backgroundColor,
        backgroundImage: `radial-gradient(${FLOW_DOT_COLOR} ${FLOW_DOT_SIZE}px, transparent ${FLOW_DOT_SIZE}px)`,
        backgroundSize: `${gap}px ${gap}px`,
        backgroundPosition: `${x % gap}px ${y % gap}px`,
      }}
    />
  );
}
