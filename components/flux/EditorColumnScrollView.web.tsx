import React from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';

export type EditorColumnScrollViewProps = ScrollViewProps & {
  nestable?: boolean;
};

/**
 * Web: never use nestable scroll (avoids pulling react-native-draggable-flatlist into the bundle).
 */
export function EditorColumnScrollView({ children, ...props }: EditorColumnScrollViewProps) {
  return <ScrollView {...props}>{children}</ScrollView>;
}
