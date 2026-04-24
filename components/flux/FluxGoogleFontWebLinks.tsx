import React from 'react';
import { Platform } from 'react-native';
import Head from 'expo-router/head';
import { fluxGoogleFontsCss2Href } from '@/lib/flux/googleFontsCatalog';

/**
 * Injects Google Fonts stylesheets on web so `fontFamily: 'Playfair Display'` (etc.) resolves in Flux preview and pickers.
 */
export function FluxGoogleFontWebLinks({ families }: { families: readonly string[] }) {
  if (Platform.OS !== 'web') return null;
  const href = fluxGoogleFontsCss2Href(families);
  if (!href) return null;
  return (
    <Head>
      <link rel="stylesheet" href={href} />
    </Head>
  );
}
