import { View, Text, Pressable, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRightIcon } from 'react-native-heroicons/outline';
import { useState } from 'react';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  const router = useRouter();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <View className="flex-row items-center">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const isHovered = hoveredIndex === index;
        
        return (
          <View key={index} className="flex-row items-center">
            {item.href ? (
              <Pressable
                onPress={() => router.push(item.href!)}
                onHoverIn={() => Platform.OS === 'web' && setHoveredIndex(index)}
                onHoverOut={() => Platform.OS === 'web' && setHoveredIndex(null)}
                className={`px-3 py-1.5 rounded-lg mr-1 ${
                  isHovered ? 'bg-[rgba(42,42,42,0.6)]' : 'bg-transparent'
                }`}
              >
                <Text 
                  className={`font-instrument ${
                    isLast ? 'text-base font-instrument-semibold' : 'text-sm'
                  } ${isHovered ? 'text-white' : isLast ? 'text-white' : 'text-gray-400'}`}
                >
                  {item.label}
                </Text>
              </Pressable>
            ) : (
              <View className="px-2 py-1">
                <Text 
                  className={`font-instrument ${
                    isLast 
                      ? 'text-white font-instrument-semibold text-base' 
                      : 'text-gray-400 text-sm'
                  }`}
                >
                  {item.label}
                </Text>
              </View>
            )}
            {!isLast && (
              <View className="mx-1">
                <ChevronRightIcon size={14} color="#4B5563" />
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

