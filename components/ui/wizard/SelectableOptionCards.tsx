import { Pressable, Text, View } from 'react-native';

type SelectableOptionCardsProps<T extends string> = {
  options: Array<{
    id: T;
    label: string;
    description?: string;
  }>;
  selectedId: T;
  onSelect: (id: T) => void;
};

export function SelectableOptionCards<T extends string>({
  options,
  selectedId,
  onSelect,
}: SelectableOptionCardsProps<T>) {
  return (
    <View className="gap-3">
      {options.map((option) => {
        const selected = selectedId === option.id;
        return (
          <Pressable
            key={option.id}
            onPress={() => onSelect(option.id)}
            className={`rounded-xl border p-4 ${
              selected
                ? 'border-brand-orange bg-brand-orange/10'
                : 'border-[#2A2A2A] bg-[#121212]'
            }`}
          >
            <Text
              className={
                selected
                  ? 'text-brand-orange font-instrument-semibold'
                  : 'text-white font-instrument-medium'
              }
            >
              {option.label}
            </Text>
            {option.description ? (
              <Text className="text-gray-400 font-instrument text-sm mt-1">
                {option.description}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** @deprecated Use SelectableOptionCards */
export const WizardSelectableCards = SelectableOptionCards;
