import { useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import { cn } from '@/lib/cn';
import { Alert, Image, Platform, Text, View } from 'react-native';
import {
  ArrowDownTrayIcon,
  ArrowUpOnSquareIcon,
  CheckCircleIcon,
  DevicePhoneMobileIcon,
  EllipsisHorizontalIcon,
  EllipsisVerticalIcon,
  GlobeAltIcon,
  HomeIcon,
  Squares2X2Icon,
} from 'react-native-heroicons/outline';
import { Button } from '@/components/ui/button';
import { BrandedStandalonePageShell } from '@/components/ui/layout';
import { useAccount } from '@/contexts/AccountContext';
import {
  browserSupportsAndroidWebInstallPrompt,
  type ClientEnvironment,
  parseClientEnvironment,
} from '@/lib/web/clientEnvironment';
import {
  consumeInstallGatePendingReturn,
  markWebInstallGateAlwaysDismissed,
  setInstallGateSessionContinue,
  shouldShowIosSafariInstallSkipActions,
} from '@/lib/web/installGateSkip';
import { usePwaInstallPrompt } from '@/lib/web/usePwaInstallPrompt';

type HeroIcon = ComponentType<{ size?: number; color?: string }>;

type InstallStepSpec = {
  Icon: HeroIcon;
  title: string;
  body: string;
};

const ICON_ACCENT = '#F3683D';
const ICON_MUTED = '#A8A8A8';

function InstallStepRow({
  step,
  total,
  Icon,
  title,
  body,
}: InstallStepSpec & { step: number; total: number }) {
  const isLast = step === total;
  return (
    <View className="flex-row">
      <View className="items-center mr-3">
        <View
          className="w-11 h-11 rounded-2xl items-center justify-center border border-white/[0.12]"
          style={{ backgroundColor: 'rgba(243, 68, 13, 0.12)' }}
        >
          <Icon size={22} color={ICON_ACCENT} />
        </View>
        {!isLast ? <View className="w-px h-6 mt-2 bg-white/10" /> : null}
      </View>
      <View className={cn('flex-1', !isLast && 'pb-5')}>
        <Text className="text-[11px] font-instrument-semibold uppercase tracking-wider text-brand-orange/90">
          Step {step}
        </Text>
        <Text className="text-white font-instrument-semibold text-base mt-0.5">{title}</Text>
        <Text className="text-white/65 font-instrument text-sm mt-1.5 leading-5">{body}</Text>
      </View>
    </View>
  );
}

function InstallStepsCard({
  platformLabel,
  PlatformIcon,
  steps,
}: {
  platformLabel: string;
  PlatformIcon: HeroIcon;
  steps: InstallStepSpec[];
}) {
  const cardShadow =
    Platform.OS === 'web'
      ? { boxShadow: '0 16px 48px rgba(0,0,0,0.45)' }
      : {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.35,
          shadowRadius: 20,
          elevation: 12,
        };

  return (
    <View className="mt-8 w-full rounded-2xl overflow-hidden border border-white/[0.09]" style={cardShadow}>
      <View className="bg-[#161616] px-5 pt-5 pb-4">
        <View className="flex-row items-center gap-3 pb-4 border-b border-white/[0.07]">
          <View className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] items-center justify-center">
            <PlatformIcon size={22} color={ICON_MUTED} />
          </View>
          <View className="flex-1">
            <Text className="text-white/45 font-instrument text-xs uppercase tracking-wide">How to install</Text>
            <Text className="text-white font-instrument-semibold text-lg mt-0.5">{platformLabel}</Text>
          </View>
        </View>
        <View className="pt-5">
          {steps.map((s, i) => (
            <InstallStepRow
              key={s.title}
              {...s}
              step={i + 1}
              total={steps.length}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const IOS_SAFARI_STEPS: InstallStepSpec[] = [
  {
    Icon: ArrowUpOnSquareIcon,
    title: 'Open the Share menu',
    body: 'Tap the Share button (square with an arrow up) in Safari’s toolbar.',
  },
  {
    Icon: HomeIcon,
    title: 'Add to Home Screen',
    body: 'Scroll the sheet and tap Add to Home Screen.',
  },
  {
    Icon: CheckCircleIcon,
    title: 'Confirm and launch',
    body: 'Tap Add, then open Furnace from your home screen — not from this tab.',
  },
];

/** Chrome, Edge, Firefox, etc. on iOS (no `beforeinstallprompt` — menu-based install). */
const IOS_THIRD_PARTY_BROWSER_STEPS: InstallStepSpec[] = [
  {
    Icon: EllipsisHorizontalIcon,
    title: 'Open the browser menu',
    body: 'Tap ••• in the toolbar (often bottom-right on iPhone).',
  },
  {
    Icon: ArrowDownTrayIcon,
    title: 'Add to Home Screen',
    body: 'Tap Add to Home Screen (wording may vary slightly), then confirm.',
  },
  {
    Icon: HomeIcon,
    title: 'Open from the icon',
    body: 'Launch Furnace from your home screen — not from this browser tab.',
  },
];

const ANDROID_CHROMIUM_STEPS: InstallStepSpec[] = [
  {
    Icon: ArrowDownTrayIcon,
    title: 'Use Install app (full-screen PWA)',
    body: 'Tap Install Furnace above when it appears, or open ⋮ → Install app. A basic “Add to Home screen” shortcut often opens inside Chrome with the address bar — use Install app for the real app.',
  },
  {
    Icon: Squares2X2Icon,
    title: 'Open from the launcher icon',
    body: 'After installing, open Furnace from your home screen or app drawer. You should not see Chrome’s address bar.',
  },
];

const ANDROID_FIREFOX_STEPS: InstallStepSpec[] = [
  {
    Icon: EllipsisVerticalIcon,
    title: 'Open the menu',
    body: 'Tap ⋮ in the toolbar.',
  },
  {
    Icon: ArrowDownTrayIcon,
    title: 'Install or add to home',
    body: 'Choose Install, Add to Home screen, or similar if you see it.',
  },
  {
    Icon: Squares2X2Icon,
    title: 'Open from the shortcut',
    body: 'Use your home screen or app list to open Furnace.',
  },
];

const OTHER_INSTALL_STEPS: InstallStepSpec[] = [
  {
    Icon: GlobeAltIcon,
    title: 'Install or add to home',
    body: 'Use your browser’s menu to install this site or use “Add to Home Screen”.',
  },
  {
    Icon: HomeIcon,
    title: 'Use the installed shortcut',
    body: 'After installing, open the app from the icon — not from this browser tab.',
  },
];

function getInstallStepsForEnvironment(env: ClientEnvironment): InstallStepSpec[] {
  if (env.device === 'ios') {
    if (env.browser === 'safari') return IOS_SAFARI_STEPS;
    return IOS_THIRD_PARTY_BROWSER_STEPS;
  }
  if (env.device === 'android') {
    if (env.browser === 'firefox') return ANDROID_FIREFOX_STEPS;
    return ANDROID_CHROMIUM_STEPS;
  }
  return OTHER_INSTALL_STEPS;
}

function cardPlatformIcon(env: ClientEnvironment): HeroIcon {
  return env.device === 'other' ? GlobeAltIcon : DevicePhoneMobileIcon;
}

const LOGO_SOURCE =
  Platform.OS === 'web'
    ? ({ uri: '/web-app-manifest-512x512.png' } as const)
    : (require('../assets/icon.png') as number);

export default function InstallGuideScreen() {
  const router = useRouter();
  const { user } = useAccount();
  const [alwaysDismissBusy, setAlwaysDismissBusy] = useState(false);
  const clientEnv = useMemo(
    () => (Platform.OS === 'web' ? parseClientEnvironment() : null),
    [],
  );
  const { canPromptInstall, promptInstall } = usePwaInstallPrompt();
  const installSteps = useMemo(
    () => (clientEnv ? getInstallStepsForEnvironment(clientEnv) : OTHER_INSTALL_STEPS),
    [clientEnv],
  );
  const showIosSafariSkip = shouldShowIosSafariInstallSkipActions(clientEnv);

  const showAndroidChromiumMenuHint =
    Platform.OS === 'web' &&
    clientEnv?.device === 'android' &&
    browserSupportsAndroidWebInstallPrompt(clientEnv.browser) &&
    !canPromptInstall;

  const navigateToPendingReturn = useCallback(() => {
    const href = consumeInstallGatePendingReturn('/');
    router.replace(href as Href);
  }, [router]);

  const onNativeInstall = useCallback(async () => {
    const outcome = await promptInstall();
    if (outcome === 'failed') {
      Alert.alert(
        'Could not show install',
        'Try again, or use ⋮ → Install app in Chrome. Open this site in normal Chrome (not another app’s built-in browser).',
      );
    }
  }, [promptInstall]);

  const onContinueInBrowser = useCallback(() => {
    setInstallGateSessionContinue();
    navigateToPendingReturn();
  }, [navigateToPendingReturn]);

  const onAlwaysDismiss = useCallback(async () => {
    if (alwaysDismissBusy) return;
    setAlwaysDismissBusy(true);
    try {
      await markWebInstallGateAlwaysDismissed(user?.id ?? null);
      navigateToPendingReturn();
    } finally {
      setAlwaysDismissBusy(false);
    }
  }, [alwaysDismissBusy, navigateToPendingReturn, user?.id]);

  return (
    <BrandedStandalonePageShell showLogo={false} centerContent={false}>
      <Image source={LOGO_SOURCE} style={{ width: 88, height: 88 }} resizeMode="contain" />
      <Text className="text-white font-instrument-semibold text-2xl text-center mt-6">
        Install Furnace
      </Text>
      <Text className="text-white/70 font-instrument text-base text-center mt-3 leading-6">
        Furnace works best as an app on your phone. Add it to your home screen, then open it from
        there.
      </Text>

      {canPromptInstall ? (
        <View className="mt-6 w-full">
          <Button variant="default" className="w-full" fullWidth onPress={onNativeInstall}>
            Install Furnace
          </Button>
          <Text className="text-white/50 font-instrument text-xs text-center mt-2 leading-4">
            This installs the real app (standalone). If you cancel, use the steps below — avoid shortcut-only
            “Add to Home screen” if you want full-screen without Chrome’s bar.
          </Text>
        </View>
      ) : null}

      {showAndroidChromiumMenuHint ? (
        <Text className="text-white/55 font-instrument text-sm text-center mt-5 leading-5 px-1">
          No button yet? Open ⋮ and choose{' '}
          <Text className="text-white/80 font-instrument-semibold">Install app</Text> (not only “Add to Home
          screen”, which can keep opening inside Chrome). Pull to refresh if the site just updated. If you opened
          this link inside another app, switch to Chrome first — those in-app browsers usually can’t install.
        </Text>
      ) : null}

      <InstallStepsCard
        platformLabel={clientEnv?.environmentTitle ?? 'This device · Browser'}
        PlatformIcon={clientEnv ? cardPlatformIcon(clientEnv) : GlobeAltIcon}
        steps={installSteps}
      />

      <Text className="text-white/50 font-instrument text-sm text-center mt-6 leading-5">
        On a wide screen (desktop mode), you can keep using Furnace in the browser without
        installing.
      </Text>

      {showIosSafariSkip ? (
        <View className="mt-8 w-full gap-3">
          <Button variant="secondary" className="w-full" fullWidth onPress={onContinueInBrowser}>
            Continue to app
          </Button>
          <Button
            variant="link"
            className="w-full"
            fullWidth
            disabled={alwaysDismissBusy}
            onPress={() => {
              void onAlwaysDismiss();
            }}
          >
            Don't show this again
          </Button>
        </View>
      ) : null}
    </BrandedStandalonePageShell>
  );
}
