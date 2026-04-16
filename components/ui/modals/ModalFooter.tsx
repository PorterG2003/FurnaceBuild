import React from 'react';
import { StyleSheet, View } from 'react-native';

const GAP = 12;
/** Min width per slot so the row wraps on narrow modals (e.g. mobile); each button then gets full width and label doesn't wrap. */
const MIN_SLOT_WIDTH = 180;

export interface ModalFooterProps {
  children: React.ReactNode;
  /**
   * `wrap` (default): equal flex slots that wrap on narrow modals.
   * `inline`: single row, equal-width columns — children should fill width (e.g. `Button fullWidth`).
   */
  layout?: 'wrap' | 'inline';
}

/**
 * Lays out modal footer actions in a row. Default layout wraps on narrow modals;
 * `inline` keeps actions on one row with each slot growing equally.
 */
export function ModalFooter({ children, layout = 'wrap' }: ModalFooterProps) {
  const childArray = React.Children.toArray(children);
  if (layout === 'inline') {
    return (
      <View style={styles.inlineRow}>
        {childArray.map((child, index) => (
          <View key={index} style={styles.inlineItem}>
            <View style={styles.inlineItemFill}>{child}</View>
          </View>
        ))}
      </View>
    );
  }
  return (
    <View style={styles.row}>
      {childArray.map((child, index) => (
        <View key={index} style={styles.slot}>
          {child}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
  },
  slot: {
    flex: 1,
    minWidth: MIN_SLOT_WIDTH,
  },
  inlineRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: GAP,
    width: '100%',
    minWidth: 0,
    alignItems: 'stretch',
  },
  inlineItem: {
    flex: 1,
    minWidth: 0,
  },
  inlineItemFill: {
    width: '100%',
    flex: 1,
    minWidth: 0,
  },
});
