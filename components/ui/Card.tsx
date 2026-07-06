import React from 'react';
import { View, Pressable, useWindowDimensions } from 'react-native';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout';

export type CardVariant = 'card' | 'inline';

interface CardProps {
  children: React.ReactNode;
  /** 'card' = styled (bg, border, rounded); 'inline' = no chrome. Default: auto from breakpoint (inline when width < LAYOUT_BREAKPOINT). */
  variant?: CardVariant;
  /** When provided, wraps content in Pressable. */
  onPress?: () => void;
  className?: string;
}

/**
 * List-item card with styled (desktop) vs inline (mobile) variant so one implementation works for both.
 * Use in list contexts (e.g. campaign list). On mobile renders without bg/border to avoid two of everything.
 */
export const Card = React.forwardRef<View, CardProps>(function Card(
  { children, variant, onPress, className = '' },
  ref,
) {
  const { width } = useWindowDimensions();
  const resolvedVariant = variant ?? (width < LAYOUT_BREAKPOINT ? 'inline' : 'card');

  const isStyled = resolvedVariant === 'card';
  const baseClass = isStyled
    ? 'bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4'
    : '';
  const combinedClass = `${baseClass} ${className}`.trim();

  const content = (
    <View ref={ref} collapsable={false} className={combinedClass}>
      {children}
    </View>
  );

  if (onPress) {
    return <Pressable onPress={onPress}>{content}</Pressable>;
  }
  return content;
});
