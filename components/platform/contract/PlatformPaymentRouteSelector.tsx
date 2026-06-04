import { Pressable, Text, View } from 'react-native';
import {
  PLATFORM_PAYMENT_ROUTE_OPTIONS,
  getPlatformPaymentRouteOption,
  type PlatformPaymentRoute,
} from '@/lib/billing/paymentRoutes';

export function PlatformPaymentRouteSelector({
  selectedRoute,
  onSelect,
  disabled = false,
  defaultRoute,
  defaultPillLabel = 'Current default',
}: {
  selectedRoute: PlatformPaymentRoute;
  onSelect: (route: PlatformPaymentRoute) => void;
  disabled?: boolean;
  defaultRoute?: PlatformPaymentRoute | null;
  defaultPillLabel?: string;
}) {
  const defaultRouteOption = defaultRoute ? getPlatformPaymentRouteOption(defaultRoute) : null;

  return (
    <View className="gap-3">
      {PLATFORM_PAYMENT_ROUTE_OPTIONS.map((option) => {
        const selected = option.id === selectedRoute;
        const isDefault = option.id === defaultRoute;

        return (
          <Pressable
            key={option.id}
            onPress={() => onSelect(option.id)}
            disabled={disabled}
            className={`rounded-2xl border p-4 ${
              selected ? 'border-brand-orange bg-[#22160F]' : 'border-[#2A2A2A] bg-[#181818]'
            } ${disabled ? 'opacity-60' : ''}`}
          >
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Text selectable={false} className="text-white text-lg font-instrument-semibold">
                  {option.label}
                </Text>
                <Text selectable={false} className="text-gray-300 font-instrument mt-1">
                  {option.description}
                </Text>
              </View>

              {isDefault ? (
                <View className="rounded-full border border-white/20 bg-white/10 px-3 py-1">
                  <Text
                    selectable={false}
                    className="text-[11px] font-instrument-medium uppercase tracking-[1px] text-gray-200"
                  >
                    {defaultPillLabel}
                  </Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        );
      })}

      {defaultRouteOption ? (
        <Text selectable={false} className="text-gray-400 font-instrument text-sm">
          Updating the payment method also updates the default billing method used for future
          recurring invoices and future amendment retries. Current default: {defaultRouteOption.label}.
        </Text>
      ) : null}
    </View>
  );
}
