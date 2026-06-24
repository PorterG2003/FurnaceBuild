import type { ReactNode } from 'react';
import { View } from 'react-native';

export function CsvImportWizardContentShell({ children }: { children: ReactNode }) {
  return <View className="w-full gap-6">{children}</View>;
}
