import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { BaseModal } from '@/components/ui/BaseModal';
import { Button } from '@/components/ui/button';
import { TrashIcon } from 'react-native-heroicons/outline';

interface AICategorizerNodeModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (data: {
    label?: string;
    categories?: string[];
  }) => void;
  initialData?: {
    label?: string;
    categories?: string[];
  };
}

export function AICategorizerNodeModal({
  visible,
  onClose,
  onSave,
  initialData,
}: AICategorizerNodeModalProps) {
  const [label, setLabel] = useState(initialData?.label || 'AI Categorizer');
  const [categories, setCategories] = useState<string[]>(
    initialData?.categories || ['']
  );

  const handleAddCategory = () => {
    setCategories([...categories, '']);
  };

  const handleRemoveCategory = (index: number) => {
    setCategories(categories.filter((_, i) => i !== index));
  };

  const handleCategoryChange = (index: number, value: string) => {
    const newCategories = [...categories];
    newCategories[index] = value;
    setCategories(newCategories);
  };

  const handleSave = () => {
    onSave({
      label,
      categories: categories.filter((c) => c.trim() !== ''),
    });
    onClose();
  };

  const footer = (
    <View className="flex-row gap-3">
      <View className="flex-1">
        <TouchableOpacity
          onPress={onClose}
          className="border border-[#3A3A3A] rounded-xl px-6 py-3 items-center justify-center"
          style={{
            borderWidth: 1,
            borderColor: '#3A3A3A',
          }}
        >
          <Text className="text-white font-instrument-medium text-base">
            Cancel
          </Text>
        </TouchableOpacity>
      </View>
      <View className="flex-1">
        <Button onPress={handleSave}>
          Save
        </Button>
      </View>
    </View>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Configure AI Categorizer Node"
      description="Configure the categories for AI categorization"
      footer={footer}
      maxWidth="lg"
    >
      <View className="gap-4">
        <View>
          <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
            Label
          </Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="Node label"
            placeholderTextColor="#666"
            className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
            style={{
              borderColor: '#FFFFFF4D',
              backgroundColor: '#FFFFFF0D',
              color: '#FFFFFF',
              borderWidth: 1,
            }}
            selectionColor="#FF4D00"
            underlineColorAndroid="transparent"
          />
        </View>

        <View>
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-sm font-instrument-medium text-gray-300">
              Categories
            </Text>
            <TouchableOpacity
              onPress={handleAddCategory}
              className="px-3 py-1.5 rounded-lg border border-[#3A3A3A] bg-[#2A2A2A]"
            >
              <Text className="text-white font-instrument-medium text-sm">
                Add Category
              </Text>
            </TouchableOpacity>
          </View>
          <ScrollView className="max-h-64" showsVerticalScrollIndicator={false}>
            <View className="gap-2">
              {categories.map((category, index) => (
                <View key={index} className="flex-row items-center gap-2">
                  <TextInput
                    value={category}
                    onChangeText={(value) => handleCategoryChange(index, value)}
                    placeholder={`Category ${index + 1}`}
                    placeholderTextColor="#666"
                    className="flex-1 border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
                    style={{
                      borderColor: '#FFFFFF4D',
                      backgroundColor: '#FFFFFF0D',
                      color: '#FFFFFF',
                      borderWidth: 1,
                    }}
                    selectionColor="#FF4D00"
                    underlineColorAndroid="transparent"
                  />
                  {categories.length > 1 && (
                    <TouchableOpacity
                      onPress={() => handleRemoveCategory(index)}
                      className="p-3 rounded-lg border border-red-500/30 bg-red-500/20"
                    >
                      <TrashIcon size={18} color="#ef4444" />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </BaseModal>
  );
}

