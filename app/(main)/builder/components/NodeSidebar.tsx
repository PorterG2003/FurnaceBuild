import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, Platform } from 'react-native';
import Animated, { useAnimatedStyle, withTiming, useSharedValue, Easing } from 'react-native-reanimated';
import { PlusIcon } from 'react-native-heroicons/outline';
import { nodeTypeMetadata, nodeIcons } from '../nodes/nodeMetadata';

interface NodeSidebarProps {
  onAddNode: (nodeType: string) => void;
}

// Group nodes by category
// Note: 'leadSource' (Lead Bucket) is excluded - it's automatically added and cannot be removed
const categories = {
  actions: {
    label: 'Actions',
    nodeTypes: ['email', 'waitTime', 'dataSender'],
  },
  logic: {
    label: 'Logic',
    nodeTypes: ['aiCategorizer'],
  },
};

// Module-level variable to persist expanded state
let persistedExpandedState = false; // Start collapsed by default

function NodeSidebar({ onAddNode }: NodeSidebarProps) {
  const [isExpanded, setIsExpanded] = useState(persistedExpandedState);

  // Animated width values: collapsed = 56px (same as NavBar), expanded = 280px
  const width = useSharedValue(persistedExpandedState ? 280 : 56);
  const contentOpacity = useSharedValue(persistedExpandedState ? 1 : 0);

  // Toggle expanded state (for collapse button)
  const toggleExpanded = () => {
    const newExpanded = !isExpanded;
    setIsExpanded(newExpanded);
    persistedExpandedState = newExpanded;
  };

  // Animate based on isExpanded state
  useEffect(() => {
    const targetWidth = isExpanded ? 280 : 56;
    const targetOpacity = isExpanded ? 1 : 0;
    
    const animationConfig = {
      duration: 300,
      easing: Easing.out(Easing.cubic),
    };
    
    width.value = withTiming(targetWidth, animationConfig);
    contentOpacity.value = withTiming(targetOpacity, animationConfig);
  }, [isExpanded, width, contentOpacity]);

  const animatedContainerStyle = useAnimatedStyle(() => {
    return {
      width: width.value,
      overflow: 'hidden',
    };
  });

  const animatedContentStyle = useAnimatedStyle(() => {
    return {
      opacity: contentOpacity.value,
    };
  });

  // Hover handlers for web
  const mouseProps = Platform.OS === 'web' ? {
    onMouseEnter: () => {
      if (!isExpanded) {
        persistedExpandedState = true;
        setIsExpanded(true);
      }
    },
    onMouseLeave: () => {
      if (isExpanded) {
        persistedExpandedState = false;
        setIsExpanded(false);
      }
    },
  } : {};

  return (
    <Animated.View
      style={[
        {
          backgroundColor: '#1A1A1A',
          borderLeftWidth: 1,
          borderLeftColor: '#2A2A2A',
          height: '100%',
          position: 'relative',
        },
        animatedContainerStyle,
      ]}
      {...(mouseProps as any)}
    >
      {/* Content - Animated opacity */}
      {isExpanded && (
        <Animated.View
          style={[
            {
              flex: 1,
            },
            animatedContentStyle,
          ]}
        >
        <View
          style={{
            padding: 20,
            borderBottomWidth: 1,
            borderBottomColor: '#2A2A2A',
          }}
        >
          <Text
            style={{
              color: '#FFFFFF',
              fontSize: 18,
              fontWeight: '600',
              fontFamily: 'Instrument Sans, system-ui, sans-serif',
            }}
          >
            Node Library
          </Text>
          <Text
            style={{
              color: '#9CA3AF',
              fontSize: 12,
              marginTop: 4,
              fontFamily: 'Instrument Sans, system-ui, sans-serif',
            }}
          >
            Click to add nodes
          </Text>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16 }}
          showsVerticalScrollIndicator={false}
        >
          {Object.entries(categories).map(([categoryKey, category]) => (
            <View key={categoryKey} style={{ marginBottom: 24 }}>
              <Text
                style={{
                  color: '#9CA3AF',
                  fontSize: 12,
                  fontWeight: '600',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  marginBottom: 12,
                  fontFamily: 'Instrument Sans, system-ui, sans-serif',
                }}
              >
                {category.label}
              </Text>
              {category.nodeTypes.map((nodeType) => {
                const metadata = nodeTypeMetadata[nodeType as keyof typeof nodeTypeMetadata];
                if (!metadata) return null;

                const IconComponent = nodeIcons[nodeType as keyof typeof nodeIcons];
                
                return (
                  <Pressable
                    key={nodeType}
                    onPress={() => onAddNode(nodeType)}
                    style={({ pressed }) => ({
                      backgroundColor: pressed ? '#2A2A2A' : '#232323',
                      borderWidth: 1,
                      borderColor: '#2A2A2A',
                      borderRadius: 12,
                      padding: 14,
                      marginBottom: 8,
                      ...(Platform.OS === 'web' && {
                        transition: 'all 0.15s ease',
                        cursor: 'pointer',
                      }),
                    })}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      {IconComponent && (
                        <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
                          <IconComponent size={20} color="#f85102" />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            color: '#FFFFFF',
                            fontSize: 14,
                            fontWeight: '600',
                            fontFamily: 'Instrument Sans, system-ui, sans-serif',
                            marginBottom: 2,
                          }}
                        >
                          {metadata.label}
                        </Text>
                        <Text
                          style={{
                            color: '#9CA3AF',
                            fontSize: 12,
                            fontFamily: 'Instrument Sans, system-ui, sans-serif',
                          }}
                        >
                          {metadata.description}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>
        </Animated.View>
      )}

      {/* Plus Icon - Always visible when collapsed */}
      {!isExpanded && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              backgroundColor: 'rgba(42, 42, 42, 0.6)',
              borderWidth: 1,
              borderColor: '#3A3A3A',
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <PlusIcon size={20} color="#ffffff" />
          </View>
        </View>
      )}
    </Animated.View>
  );
}

export { NodeSidebar };
export default NodeSidebar;

