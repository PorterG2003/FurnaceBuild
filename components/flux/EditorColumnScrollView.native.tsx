import React from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';
import { NestableScrollContainer } from 'react-native-draggable-flatlist';

export type EditorColumnScrollViewProps = ScrollViewProps & {
  nestable?: boolean;
};

/**
 * Native: optional NestableScrollContainer for nested NestableDraggableFlatList.
 */
export function EditorColumnScrollView({
  nestable,
  children,
  ...props
}: EditorColumnScrollViewProps) {
  if (nestable) {
    return <NestableScrollContainer {...props}>{children}</NestableScrollContainer>;
  }
  return <ScrollView {...props}>{children}</ScrollView>;
}
