import React from 'react';
import { TouchableOpacity, Text, TouchableOpacityProps } from 'react-native';
import { cn } from '@/lib/cn';

interface ButtonProps extends TouchableOpacityProps {
  variant?: 'default' | 'secondary' | 'outline';
  size?: 'default' | 'sm' | 'lg';
  children: React.ReactNode;
}

export function Button({
  variant = 'default',
  size = 'default',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <TouchableOpacity
      className={cn(
        'items-center justify-center rounded-xl font-instrument-medium',
        {
          'bg-brand-orange text-white': variant === 'default' && !props.disabled,
          'bg-brand-orange/50 text-white/70': variant === 'default' && props.disabled,
          'bg-secondary text-secondary-foreground': variant === 'secondary',
          'border border-input bg-transparent': variant === 'outline',
        },
        {
          'px-6 py-3': size === 'default',
          'px-4 py-2': size === 'sm',
          'px-8 py-4': size === 'lg',
        },
        className
      )}
      activeOpacity={0.8}
      {...props}
    >
      <Text
        className={cn(
          'font-instrument-medium',
          {
            'text-white': variant === 'default',
            'text-black': variant === 'secondary',
            'text-foreground': variant === 'outline',
          },
          {
            'text-base': size === 'default',
            'text-sm': size === 'sm',
            'text-lg': size === 'lg',
          }
        )}
      >
        {children}
      </Text>
    </TouchableOpacity>
  );
}

