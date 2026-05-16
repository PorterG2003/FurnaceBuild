import React from 'react';
import { TouchableOpacity, Text, TouchableOpacityProps } from 'react-native';
import { cn } from '@/lib/cn';

interface ButtonProps extends TouchableOpacityProps {
  variant?: 'default' | 'secondary' | 'outline' | 'destructive' | 'destructive-solid' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'xs' | '2xs';
  /** When true, button stretches to full width of its container (e.g. single-button modal footer). */
  fullWidth?: boolean;
  children: React.ReactNode;
}

export function Button({
  variant = 'default',
  size = 'default',
  className,
  fullWidth = false,
  children,
  ...props
}: ButtonProps) {
  return (
    <TouchableOpacity
      className={cn(
        'items-center justify-center font-instrument-medium flex-row',
        fullWidth && 'self-stretch',
        {
          'rounded-md': size === '2xs',
          'rounded-lg': size === 'xs',
          'rounded-xl': size !== '2xs' && size !== 'xs',
        },
        {
          'bg-brand-orange text-white': variant === 'default' && !props.disabled,
          'bg-brand-orange/50 text-white/70': variant === 'default' && props.disabled,
          'border border-[#3A3A3A] bg-[#2A2A2A]': variant === 'secondary' && !props.disabled,
          'border border-[#3A3A3A]/50 bg-[#2A2A2A]/50': variant === 'secondary' && props.disabled,
          'border border-white/20 bg-white/5': variant === 'outline',
          'border border-red-500/30 bg-red-500/20': variant === 'destructive' && !props.disabled,
          'border border-red-500/20 bg-red-500/10': variant === 'destructive' && props.disabled,
          'border border-red-500/50 bg-red-500': variant === 'destructive-solid' && !props.disabled,
          'border border-red-500/30 bg-red-500/50': variant === 'destructive-solid' && props.disabled,
          'bg-transparent': variant === 'link',
        },
        {
          'px-6 py-3': size === 'default',
          'px-4 py-2': size === 'sm',
          'px-8 py-4': size === 'lg',
          'px-2 py-1': size === 'xs',
          'px-1.5 py-0.5': size === '2xs',
        },
        className
      )}
      activeOpacity={0.8}
      {...props}
    >
      {React.isValidElement(children) && children.type !== Text ? (
        children
      ) : (
        <Text
          numberOfLines={2}
          ellipsizeMode="clip"
          className={cn(
            'font-instrument-medium',
            {
              'text-white': variant === 'default' || variant === 'secondary' || variant === 'destructive-solid',
              'text-red-300': variant === 'destructive' && !props.disabled,
              'text-red-400/70': variant === 'destructive' && props.disabled,
              'text-white/90': variant === 'destructive-solid' && !props.disabled,
              'text-white/60': variant === 'destructive-solid' && props.disabled,
              'text-gray-200': variant === 'outline',
              'text-brand-orange': variant === 'link',
            },
            {
              'text-base': size === 'default',
              'text-sm': size === 'sm',
              'text-lg': size === 'lg',
              'text-xs': size === 'xs',
              'text-[11px] leading-tight': size === '2xs',
            }
          )}
        >
          {children}
        </Text>
      )}
    </TouchableOpacity>
  );
}

