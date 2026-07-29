function polarToCartesian(cx: number, cy: number, r: number, angleRad: number) {
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

function formatPoint(point: { x: number; y: number }) {
  return `${point.x} ${point.y}`;
}

type RingPathArgs = {
  cx: number;
  cy: number;
  radius: number;
  halfStroke: number;
  startAngle: number;
  endAngle: number;
};

function ringArcParts({
  cx,
  cy,
  radius,
  halfStroke,
  startAngle,
  endAngle,
}: RingPathArgs) {
  const outerR = radius + halfStroke;
  const innerR = radius - halfStroke;
  const span = endAngle - startAngle;
  const fullCircle = span >= 2 * Math.PI - 1e-6;

  const outer0 = polarToCartesian(cx, cy, outerR, startAngle);
  const outer1 = polarToCartesian(cx, cy, outerR, endAngle);
  const inner0 = polarToCartesian(cx, cy, innerR, startAngle);
  const inner1 = polarToCartesian(cx, cy, innerR, endAngle);

  const midSpan = startAngle + span / 2;
  const outerMid = polarToCartesian(cx, cy, outerR, midSpan);
  const innerMid = polarToCartesian(cx, cy, innerR, midSpan);

  const outerArc = fullCircle
    ? `A ${outerR} ${outerR} 0 0 1 ${formatPoint(outerMid)} A ${outerR} ${outerR} 0 0 1 ${formatPoint(outer1)}`
    : `A ${outerR} ${outerR} 0 ${span > Math.PI ? 1 : 0} 1 ${formatPoint(outer1)}`;

  const innerArc = fullCircle
    ? `A ${innerR} ${innerR} 0 0 0 ${formatPoint(innerMid)} A ${innerR} ${innerR} 0 0 0 ${formatPoint(inner0)}`
    : `A ${innerR} ${innerR} 0 ${span > Math.PI ? 1 : 0} 0 ${formatPoint(inner0)}`;

  return { halfStroke, outer0, outer1, inner0, inner1, outerArc, innerArc, fullCircle };
}

/**
 * Ring segment with a concave socket at startAngle and a convex bulb at endAngle.
 * Adjacent segments share joint centers so convex nests into the next concave.
 * Angles are in radians from the positive x-axis (3 o'clock), increasing clockwise
 * in SVG y-down space. Pair with a -90deg SVG rotate to start at 12 o'clock.
 */
export function buildInterlockingSegmentPath(args: RingPathArgs): string {
  const { halfStroke, outer0, inner1, outerArc, innerArc } = ringArcParts(args);

  // Convex bulb at end (clockwise semicircle past the joint)
  const convexCap = `A ${halfStroke} ${halfStroke} 0 0 1 ${formatPoint(inner1)}`;
  // Concave socket at start (counterclockwise semicircle into the segment)
  const concaveCap = `A ${halfStroke} ${halfStroke} 0 0 0 ${formatPoint(outer0)}`;

  return `M ${formatPoint(outer0)} ${outerArc} ${convexCap} ${innerArc} ${concaveCap} Z`;
}

/**
 * Open ring segment with convex bulbs on both ends (single progress "sausage").
 * At a full circle, uses interlocking ends so the seam nests cleanly.
 */
export function buildRoundEndedSegmentPath(args: RingPathArgs): string {
  const { halfStroke, outer0, inner1, outerArc, innerArc, fullCircle } =
    ringArcParts(args);

  if (fullCircle) {
    return buildInterlockingSegmentPath(args);
  }

  // Convex bulb at end (clockwise past the joint)
  const convexEnd = `A ${halfStroke} ${halfStroke} 0 0 1 ${formatPoint(inner1)}`;
  // Convex bulb at start (clockwise past the joint, outside the segment)
  const convexStart = `A ${halfStroke} ${halfStroke} 0 0 1 ${formatPoint(outer0)}`;

  return `M ${formatPoint(outer0)} ${outerArc} ${convexEnd} ${innerArc} ${convexStart} Z`;
}
