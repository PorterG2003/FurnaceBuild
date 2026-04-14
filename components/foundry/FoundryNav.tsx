import React from 'react';
import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import { Link, usePathname, type Href } from 'expo-router';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';

const LINKS: { href: string; label: string }[] = [
  { href: '/foundry', label: 'Dashboard' },
  { href: '/foundry/imports', label: 'Imports' },
  { href: '/foundry/queue', label: 'Queue' },
  { href: '/foundry/dedupe', label: 'Dedupe' },
  { href: '/foundry/runs', label: 'Runs' },
  { href: '/foundry/export', label: 'Export' },
  { href: '/foundry/csv-builder', label: 'CSV Builder' },
];

function NavLink({ href, label, horizontal }: { href: string; label: string; horizontal: boolean }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== '/foundry' && pathname?.startsWith(href));

  return (
    <Link href={href as Href} asChild>
      <Pressable
        className={
          horizontal
            ? `py-2 px-3 rounded-lg ${active ? 'bg-[rgba(243,68,13,0.12)]' : 'bg-transparent'}`
            : `py-2 px-3 rounded-lg mb-1 border ${active ? 'bg-[rgba(243,68,13,0.15)] border-brand-orange' : 'bg-[rgba(42,42,42,0.6)] border-[#3A3A3A]'}`
        }
      >
        <Text className="text-white font-instrument text-sm">{label}</Text>
      </Pressable>
    </Link>
  );
}

export function FoundryNav() {
  const { width } = useWindowDimensions();
  const horizontal = width < LAYOUT_BREAKPOINT;

  if (horizontal) {
    return (
      <View className="bg-[#1A1A1A] border-b border-[#2A2A2A] px-4 py-3">
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="text-gray-500 font-instrument-semibold text-xs uppercase tracking-wider mr-2">Foundry</Text>
          {LINKS.map((l) => (
            <NavLink key={l.href} href={l.href} label={l.label} horizontal />
          ))}
          <View className="flex-1" />
          <Link href="/" asChild>
            <Pressable className="py-2 px-3">
              <Text className="text-gray-400 font-instrument text-sm">Main app</Text>
            </Pressable>
          </Link>
        </View>
      </View>
    );
  }

  return (
    <View className="bg-[#1A1A1A] border-r border-[#2A2A2A] w-52 py-6 px-3">
      <Text className="text-gray-500 font-instrument-semibold text-xs uppercase tracking-wider px-3 mb-4">Foundry</Text>
      <View className="mb-6">
        {LINKS.map((l) => (
          <NavLink key={l.href} href={l.href} label={l.label} horizontal={false} />
        ))}
      </View>
      <View className="flex-1" />
      <Link href="/" asChild>
        <Pressable className="py-2 px-3 rounded-lg border border-[#3A3A3A]">
          <Text className="text-gray-400 font-instrument text-sm">Main app</Text>
        </Pressable>
      </Link>
    </View>
  );
}
