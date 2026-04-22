import React from 'react';
import { TouchableOpacity, Text, TouchableOpacityProps } from 'react-native';
import { cn } from '@/lib/cn';

export type IconButtonVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'ghost'
  /** Transparent, minimal padding, 20px icon — card/list ⋯ menus (pair with `hitSlop`) */
  | 'overflow';
export type IconButtonSize = 'default' | 'sm' | 'xs' | 'inline';

export interface IconButtonProps extends Omit<TouchableOpacityProps, 'children'> {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label?: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /**
   * When set (and `label` is omitted), use a fixed square footprint and `rounded-xl` to align with
   * `Button` in toolbars (`h-10 w-10` for `sm`, `h-11 w-11` for `default`, icon centered).
   */
  matchButtonPadding?: 'sm' | 'default';
}

const ICON_COLORS: Record<IconButtonVariant, { default: string; disabled: string }> = {
  default: { default: '#FFFFFF', disabled: 'rgba(255,255,255,0.7)' },
  secondary: { default: '#E5E7EB', disabled: 'rgba(229,231,235,0.7)' },
  destructive: { default: '#F87171', disabled: 'rgba(248,113,113,0.7)' },
  outline: { default: '#E5E7EB', disabled: 'rgba(229,231,235,0.7)' },
  ghost: { default: '#9CA3AF', disabled: 'rgba(156,163,175,0.7)' },
  overflow: { default: '#9CA3AF', disabled: 'rgba(156,163,175,0.7)' },
};

/** Icon px per `size`. `inline` is used internally by `variant="overflow"`. */
const ICON_SIZES: Record<IconButtonSize, number> = {
  xs: 14,
  sm: 16,
  default: 18,
  inline: 20,
};

export function IconButton({
  icon: Icon,
  label,
  variant = 'default',
  size = 'default',
  className,
  disabled = false,
  matchButtonPadding,
  ...props
}: IconButtonProps) {
  const effectiveSize: IconButtonSize = variant === 'overflow' ? 'inline' : size;
  const iconSize = ICON_SIZES[effectiveSize];
  const colors = ICON_COLORS[variant];
  const iconColor = disabled ? colors.disabled : colors.default;
  const useButtonPadding =
    !label &&
    matchButtonPadding != null &&
    (matchButtonPadding === 'sm' ? size === 'sm' : size === 'default');

  return (
    <TouchableOpacity
      className={cn(
        'items-center justify-center font-instrument-medium flex-row',
        useButtonPadding ? 'rounded-xl' : 'rounded-lg',
        {
          'bg-brand-orange': variant === 'default' && !disabled,
          'bg-brand-orange/50': variant === 'default' && disabled,
          'border border-[#3A3A3A] bg-[#2A2A2A]': variant === 'secondary' && !disabled,
          'border border-[#3A3A3A]/50 bg-[#2A2A2A]/50': variant === 'secondary' && disabled,
          'border border-white/20 bg-white/5': variant === 'outline',
          'border border-red-500/30 bg-red-500/20': variant === 'destructive' && !disabled,
          'border border-red-500/20 bg-red-500/10': variant === 'destructive' && disabled,
          'bg-transparent': variant === 'ghost' || variant === 'overflow',
          'opacity-50': disabled && (variant === 'ghost' || variant === 'overflow'),
        },
        useButtonPadding && matchButtonPadding === 'sm'
          ? { 'h-10 w-10 shrink-0 p-0': true }
          : useButtonPadding && matchButtonPadding === 'default'
            ? { 'h-11 w-11 shrink-0 p-0': true }
            : {
                'p-2': effectiveSize === 'default' && !label,
                'px-3 py-2 gap-2': effectiveSize === 'default' && label,
                'p-1.5': effectiveSize === 'sm' && !label,
                'px-2.5 py-1.5 gap-1.5': effectiveSize === 'sm' && label,
                'p-1': (effectiveSize === 'xs' && !label) || (effectiveSize === 'inline' && !label),
                'px-2 py-1 gap-1': effectiveSize === 'xs' && label,
                'px-2 py-1 gap-1.5': effectiveSize === 'inline' && label,
              },
        className
      )}
      activeOpacity={0.8}
      disabled={disabled}
      {...props}
    >
      <Icon size={iconSize} color={iconColor} />
      {label != null && label !== '' && (
        <Text
          className={cn(
            'font-instrument-medium',
            {
              'text-white': variant === 'default',
              'text-gray-200': variant === 'secondary' || variant === 'outline',
              'text-red-300': variant === 'destructive',
              'text-gray-400': variant === 'ghost' || variant === 'overflow',
            },
            {
              'text-sm': effectiveSize === 'default' || effectiveSize === 'inline',
              'text-xs': effectiveSize === 'sm' || effectiveSize === 'xs',
            }
          )}
        >
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}
