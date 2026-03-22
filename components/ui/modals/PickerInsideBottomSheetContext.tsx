import React, { createContext, useContext, type ReactNode } from 'react';

const PickerInsideBottomSheetContext = createContext(false);

export function PickerInsideBottomSheetProvider({
  value,
  children,
}: {
  value: boolean;
  children: ReactNode;
}) {
  return (
    <PickerInsideBottomSheetContext.Provider value={value}>
      {children}
    </PickerInsideBottomSheetContext.Provider>
  );
}

export function usePickerInsideBottomSheet(): boolean {
  return useContext(PickerInsideBottomSheetContext);
}

export interface BottomSheetTakeoverOptions {
  title?: string | null;
  content: ReactNode;
  /** Called when user taps back or takeover is cleared (sync host field open state). */
  onRequestDismiss?: () => void;
}

export interface BottomSheetTakeoverContextValue {
  presentTakeover: (opts: BottomSheetTakeoverOptions) => void;
  dismissTakeover: () => void;
  takeoverActive: boolean;
}

const noopTakeover: BottomSheetTakeoverContextValue = {
  presentTakeover: () => {},
  dismissTakeover: () => {},
  takeoverActive: false,
};

export const BottomSheetTakeoverContext = createContext<BottomSheetTakeoverContextValue>(noopTakeover);

export function useBottomSheetTakeover(): BottomSheetTakeoverContextValue {
  return useContext(BottomSheetTakeoverContext);
}
