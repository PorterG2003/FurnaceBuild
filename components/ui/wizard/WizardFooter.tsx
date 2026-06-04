import React from 'react';
import { StyleSheet, View } from 'react-native';

const GAP = 12;
const MIN_SLOT_WIDTH = 180;

type WizardFooterProps = {
  children: React.ReactNode;
  layout?: 'wrap' | 'inline';
};

export type { WizardFooterProps as ModalFooterProps };

export function WizardFooter({ children, layout = 'wrap' }: WizardFooterProps) {
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
