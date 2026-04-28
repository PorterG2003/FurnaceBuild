import React from 'react';
import type { ComponentType } from 'react';
import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import { Link, usePathname, type Href } from 'expo-router';
import {
  ArrowRightOnRectangleIcon,
  DocumentTextIcon,
  Squares2X2Icon,
  UserGroupIcon,
} from 'react-native-heroicons/outline';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';

type HeroOutlineIcon = ComponentType<{ size?: number; color?: string }>;

const LINKS: { href: string; label: string; icon: HeroOutlineIcon }[] = [
  { href: '/flux', label: 'Dashboard', icon: Squares2X2Icon },
  { href: '/flux/campaigns', label: 'Campaigns', icon: DocumentTextIcon },
  { href: '/flux/prospects', label: 'Prospects', icon: UserGroupIcon },
];

function NavLink({
  href,
  label,
  icon: Icon,
  horizontal,
}: {
  href: string;
  label: string;
  icon: HeroOutlineIcon;
  horizontal: boolean;
}) {
  const pathname = usePathname();
  const active = pathname === href || (href !== '/flux' && pathname?.startsWith(href));
  const iconColor = active ? '#f85102' : '#9ca3af';

  return (
    <Link href={href as Href} asChild>
      <Pressable
        className={
          horizontal
            ? `py-2 px-3 rounded-lg ${active ? 'bg-[rgba(248,81,2,0.12)]' : 'bg-transparent'}`
            : `py-2 px-3 rounded-lg mb-1 border ${active ? 'bg-[rgba(248,81,2,0.12)] border-[#f85102]' : 'bg-[rgba(42,42,42,0.6)] border-[#3A3A3A]'}`
        }
      >
        <View className="flex-row items-center gap-2">
          <Icon size={16} color={iconColor} />
          <Text className="text-white font-instrument text-sm">{label}</Text>
        </View>
      </Pressable>
    </Link>
  );
}

export function FluxNav() {
  const { width } = useWindowDimensions();
  const horizontal = width < LAYOUT_BREAKPOINT;

  if (horizontal) {
    return (
      <View className="bg-[#1A1A1A] border-b border-[#2A2A2A] px-4 py-3">
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="text-gray-500 font-instrument-semibold text-xs uppercase tracking-wider mr-2">Flux</Text>
          {LINKS.map((l) => (
            <NavLink key={l.href} href={l.href} label={l.label} icon={l.icon} horizontal />
          ))}
          <View className="flex-1" />
          <Link href="/" asChild>
            <Pressable className="py-2 px-3">
              <View className="flex-row items-center gap-2">
                <ArrowRightOnRectangleIcon size={16} color="#9ca3af" />
                <Text className="text-gray-400 font-instrument text-sm">Main app</Text>
              </View>
            </Pressable>
          </Link>
        </View>
      </View>
    );
  }

  return (
    <View className="bg-[#1A1A1A] border-r border-[#2A2A2A] w-52 py-6 px-3">
      <Text className="text-gray-500 font-instrument-semibold text-xs uppercase tracking-wider px-3 mb-4">Flux</Text>
      <View className="mb-6">
        {LINKS.map((l) => (
          <NavLink key={l.href} href={l.href} label={l.label} icon={l.icon} horizontal={false} />
        ))}
      </View>
      <View className="flex-1" />
      <Link href="/" asChild>
        <Pressable className="py-2 px-3 rounded-lg border border-[#3A3A3A]">
          <View className="flex-row items-center gap-2">
            <ArrowRightOnRectangleIcon size={16} color="#9ca3af" />
            <Text className="text-gray-400 font-instrument text-sm">Main app</Text>
          </View>
        </Pressable>
      </Link>
    </View>
  );
}
