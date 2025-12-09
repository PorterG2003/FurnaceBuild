import { useState } from 'react';
import { View, Text, ScrollView, Pressable, TouchableOpacity } from 'react-native';
import { PageLayout } from '@/components/ui/layout';

// Mock data types
interface EmailMessage {
  id: string;
  sender: string;
  senderEmail: string;
  body: string;
  timestamp: string;
  isRead: boolean;
}

interface EmailThread {
  id: string;
  subject: string;
  participants: string[];
  lastMessage: string;
  timestamp: string;
  unreadCount: number;
  messages: EmailMessage[];
}

// Mock data
const mockThreads: EmailThread[] = [
  {
    id: '1',
    subject: 'Project Proposal Discussion',
    participants: ['Sarah Johnson', 'Mike Chen'],
    lastMessage: 'Thanks for the update! Looking forward to reviewing the proposal.',
    timestamp: '2 hours ago',
    unreadCount: 2,
    messages: [
      {
        id: 'm1',
        sender: 'Sarah Johnson',
        senderEmail: 'sarah.johnson@example.com',
        body: 'Hi team, I wanted to discuss the project proposal we submitted last week. Do you have time for a quick call?',
        timestamp: 'Yesterday, 3:45 PM',
        isRead: true,
      },
      {
        id: 'm2',
        sender: 'Mike Chen',
        senderEmail: 'mike.chen@example.com',
        body: 'Sure! I can do tomorrow afternoon. What time works for you?',
        timestamp: 'Yesterday, 4:12 PM',
        isRead: true,
      },
      {
        id: 'm3',
        sender: 'Sarah Johnson',
        senderEmail: 'sarah.johnson@example.com',
        body: 'Thanks for the update! Looking forward to reviewing the proposal.',
        timestamp: '2 hours ago',
        isRead: false,
      },
    ],
  },
  {
    id: '2',
    subject: 'Budget Approval Request',
    participants: ['Finance Team'],
    lastMessage: 'The budget has been reviewed and approved. Please proceed.',
    timestamp: '5 hours ago',
    unreadCount: 0,
    messages: [
      {
        id: 'm4',
        sender: 'Finance Team',
        senderEmail: 'finance@company.com',
        body: 'The budget has been reviewed and approved. Please proceed with the implementation.',
        timestamp: '5 hours ago',
        isRead: true,
      },
    ],
  },
  {
    id: '3',
    subject: 'Weekly Team Standup',
    participants: ['Alex Rivera', 'Emma Wilson'],
    lastMessage: 'See you all at 10 AM tomorrow!',
    timestamp: '1 day ago',
    unreadCount: 1,
    messages: [
      {
        id: 'm5',
        sender: 'Alex Rivera',
        senderEmail: 'alex.rivera@example.com',
        body: 'Reminder: Weekly standup is scheduled for tomorrow at 10 AM. Please come prepared with your updates.',
        timestamp: '1 day ago',
        isRead: true,
      },
      {
        id: 'm6',
        sender: 'Emma Wilson',
        senderEmail: 'emma.wilson@example.com',
        body: 'See you all at 10 AM tomorrow!',
        timestamp: '1 day ago',
        isRead: false,
      },
    ],
  },
  {
    id: '4',
    subject: 'Client Feedback on Design',
    participants: ['Design Team', 'Client ABC'],
    lastMessage: 'The new design looks great! We love the color scheme.',
    timestamp: '2 days ago',
    unreadCount: 0,
    messages: [
      {
        id: 'm7',
        sender: 'Client ABC',
        senderEmail: 'contact@clientabc.com',
        body: 'The new design looks great! We love the color scheme and the overall layout. Just a few minor tweaks needed.',
        timestamp: '2 days ago',
        isRead: true,
      },
    ],
  },
  {
    id: '5',
    subject: 'New Feature Launch',
    participants: ['Product Team'],
    lastMessage: 'The feature is now live in production. Great work everyone!',
    timestamp: '3 days ago',
    unreadCount: 0,
    messages: [
      {
        id: 'm8',
        sender: 'Product Team',
        senderEmail: 'product@company.com',
        body: 'The feature is now live in production. Great work everyone!',
        timestamp: '3 days ago',
        isRead: true,
      },
    ],
  },
];

function ThreadItem({
  thread,
  isSelected,
  onSelect,
}: {
  thread: EmailThread;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable
      onPress={onSelect}
      className={`p-4 border-b border-[#2A2A2A] ${
        isSelected ? 'bg-[#1F1F1F]' : 'bg-transparent'
      }`}
      style={{
        borderBottomWidth: 1,
        borderBottomColor: '#2A2A2A',
        backgroundColor: isSelected ? '#1F1F1F' : 'transparent',
      }}
    >
      <View className="flex-row items-start justify-between mb-2">
        <View className="flex-1 mr-2">
          <Text
            className={`font-instrument-semibold text-base mb-1 ${
              thread.unreadCount > 0 ? 'text-white' : 'text-gray-300'
            }`}
            numberOfLines={1}
          >
            {thread.subject}
          </Text>
          <Text className="text-gray-400 font-instrument text-sm" numberOfLines={1}>
            {thread.participants.join(', ')}
          </Text>
        </View>
        {thread.unreadCount > 0 && (
          <View
            className="bg-brand-orange rounded-full px-2 py-1 min-w-[24px] items-center justify-center"
            style={{ backgroundColor: '#F3440D' }}
          >
            <Text className="text-white font-instrument-semibold text-xs">
              {thread.unreadCount}
            </Text>
          </View>
        )}
      </View>
      <Text className="text-gray-500 font-instrument text-sm mb-2" numberOfLines={2}>
        {thread.lastMessage}
      </Text>
      <Text className="text-gray-600 font-instrument text-xs">{thread.timestamp}</Text>
    </Pressable>
  );
}

function MessageItem({ message }: { message: EmailMessage }) {
  return (
    <View className="mb-6 pb-6 border-b border-[#2A2A2A]" style={{ borderBottomWidth: 1 }}>
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-1">
          <Text className="text-white font-instrument-semibold text-base mb-1">
            {message.sender}
          </Text>
          <Text className="text-gray-400 font-instrument text-sm">{message.senderEmail}</Text>
        </View>
        <Text className="text-gray-500 font-instrument text-sm">{message.timestamp}</Text>
      </View>
      <Text className="text-gray-300 font-instrument text-base leading-6">{message.body}</Text>
    </View>
  );
}

export default function InboxPage() {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(mockThreads[0]?.id || null);

  const selectedThread = mockThreads.find((t) => t.id === selectedThreadId);

  return (
    <PageLayout scrollable={false}>
      <View className="flex-1 flex-row bg-[#121212]">
        {/* Threads Panel */}
        <View className="w-96 border-r border-[#2A2A2A]" style={{ borderRightWidth: 1 }}>
          <View className="p-4 border-b border-[#2A2A2A]" style={{ borderBottomWidth: 1 }}>
            <Text className="text-2xl font-instrument-semibold text-white mb-1">Inbox</Text>
            <Text className="text-gray-400 font-instrument text-sm">
              {mockThreads.length} conversations
            </Text>
          </View>
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            {mockThreads.map((thread) => (
              <ThreadItem
                key={thread.id}
                thread={thread}
                isSelected={selectedThreadId === thread.id}
                onSelect={() => setSelectedThreadId(thread.id)}
              />
            ))}
          </ScrollView>
        </View>

        {/* Conversation Panel */}
        <View className="flex-1">
          {selectedThread ? (
            <>
              <View className="p-4 border-b border-[#2A2A2A]" style={{ borderBottomWidth: 1 }}>
                <Text className="text-xl font-instrument-semibold text-white mb-1">
                  {selectedThread.subject}
                </Text>
                <Text className="text-gray-400 font-instrument text-sm">
                  {selectedThread.participants.join(', ')}
                </Text>
              </View>
              <ScrollView
                className="flex-1"
                contentContainerStyle={{ padding: 24 }}
                showsVerticalScrollIndicator={false}
              >
                {selectedThread.messages.map((message) => (
                  <MessageItem key={message.id} message={message} />
                ))}
              </ScrollView>
            </>
          ) : (
            <View className="flex-1 items-center justify-center">
              <Text className="text-gray-400 font-instrument text-lg">
                Select a conversation to view messages
              </Text>
            </View>
          )}
        </View>
      </View>
    </PageLayout>
  );
}
