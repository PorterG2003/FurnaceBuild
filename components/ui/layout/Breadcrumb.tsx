import { View, Text, Pressable } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { ChevronRightIcon } from 'react-native-heroicons/outline';
import { useState } from 'react';
import { openAppRoute } from '@/lib/navigation/openAppRoute';
import type { BreadcrumbItem } from './DetailPageHeader';

const isWeb = typeof window !== 'undefined';

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
              isWeb && !item.openInNewTab ? (
                <View
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  style={{ marginRight: 4 }}
                >
                  <Link
                    href={item.href}
                    style={{
                      paddingVertical: 6,
                      paddingHorizontal: 12,
                      borderRadius: 8,
                      backgroundColor: isHovered ? 'rgba(42,42,42,0.6)' : 'transparent',
                    }}
                  >
                    <Text
                      className={`font-instrument ${
                        isLast ? 'text-base font-instrument-semibold' : 'text-sm'
                      } ${isHovered ? 'text-white' : isLast ? 'text-white' : 'text-gray-400'}`}
                    >
                      {item.label}
                    </Text>
                  </Link>
                </View>
              ) : (
                <Pressable
                  onPress={() =>
                    openAppRoute(router, item.href!, { newTab: item.openInNewTab ?? false })
                  }
                  onMouseEnter={isWeb ? () => setHoveredIndex(index) : undefined}
                  onMouseLeave={isWeb ? () => setHoveredIndex(null) : undefined}
                  className="px-3 py-1.5 rounded-lg mr-1"
                  style={
                    isWeb
                      ? {
                          backgroundColor: isHovered ? 'rgba(42,42,42,0.6)' : 'transparent',
                        }
                      : undefined
                  }
                >
                  <Text
                    className={`font-instrument ${
                      isLast ? 'text-base font-instrument-semibold' : 'text-sm'
                    } ${isLast ? 'text-white' : 'text-gray-400'}`}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              )
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

