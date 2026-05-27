declare global {
  // eslint-disable-next-line no-var
  var __furnaceStartupBannerShown: boolean | undefined;
}

const STARTUP_BANNER_FORMAT =
  '%c                 %c;%ca%c \n               %c,%cb%c$$%cp%c\n           %c.+%cb%c0$$0$%cw%c\n        %c,%ca%cH$$$$$$@H%c.%c\n    %c.p%cw%c0$$$$$$$0%cL%c+%c  \n %c.%ca%cH$$$$$$$$H%ca%c,%c  %c.p%c \n%c+%c$$$$$$$0%cw%c;%c   %c.;%cbHHw%c\n%c0$$$$%cLp%c.%c   %c,a%cwHHHLH%cb%c  found a bug? that\'s porter\'s problem.%c\n%c;%c$0%cp%c.%c  %c.+%cwHHHHHHHH%ca%c \n %c+.%c  %c;%cLHHHHHHHL%cb+.%c  %c  porter@getfurnace.io%c\n    %c;%cHHLHHHw%cp.%c      \n    %cp%cHHH%cb;%c    %c,pb.%c  \n     %cwb%c.%c  %c.+bwwwL;%c  \n         %c+wwwwwwa%c   \n        %c.Lbwwwa;%c    \n         %cawa,%c       \n         %c.+%c         \n';

const STARTUP_BANNER_STYLES = [
  '',
  'color:rgb(220, 29, 4)',
  'color:rgb(255, 53, 3)',
  '',
  'color:rgb(220, 29, 4)',
  'color:rgb(255, 53, 3)',
  'color:rgb(255, 85, 2)',
  'color:rgb(255, 53, 3)',
  '',
  'color:rgb(220, 29, 4)',
  'color:rgb(255, 53, 3)',
  'color:rgb(255, 85, 2)',
  'color:rgb(255, 53, 3)',
  '',
  'color:rgb(220, 29, 4)',
  'color:rgb(255, 53, 3)',
  'color:rgb(255, 85, 2)',
  'color:rgb(220, 29, 4)',
  '',
  'color:rgb(220, 29, 4)',
  'color:rgb(255, 53, 3)',
  'color:rgb(255, 85, 2)',
  'color:rgb(255, 53, 3)',
  'color:rgb(220, 29, 4)',
  '',
  'color:rgb(220, 29, 4)',
  'color:rgb(255, 53, 3)',
  'color:rgb(255, 85, 2)',
  'color:rgb(255, 53, 3)',
  'color:rgb(220, 29, 4)',
  '',
  'color:rgb(220, 29, 4)',
  '',
  'color:rgb(220, 29, 4)',
  'color:rgb(255, 85, 2)',
  'color:rgb(255, 53, 3)',
  'color:rgb(220, 29, 4)',
  '',
  'color:rgb(220, 29, 4)',
  'color:rgb(255, 53, 3)',
  '',
  'color:rgb(255, 85, 2)',
  'color:rgb(255, 53, 3)',
  'color:rgb(220, 29, 4)',
  '',
  'color:rgb(220, 29, 4)',
  'color:rgb(255, 53, 3)',
  'color:rgb(220, 29, 4)',
  'color:rgb(255, 85, 2)',
  '',
  'color:rgb(220, 29, 4)',
  'color:rgb(255, 85, 2)',
  'color:rgb(255, 53, 3)',
  'color:rgb(220, 29, 4)',
  '',
  'color:rgb(220, 29, 4)',
  'color:rgb(255, 53, 3)',
  'color:rgb(220, 29, 4)',
  '',
  'color:rgb(220, 29, 4)',
  '',
  'color:rgb(220, 29, 4)',
  'color:rgb(255, 53, 3)',
  'color:rgb(220, 29, 4)',
  '',
  'color:rgb(255, 85, 2)',
  '',
  'color:rgb(220, 29, 4)',
  'color:rgb(255, 53, 3)',
  'color:rgb(220, 29, 4)',
  '',
  'color:rgb(220, 29, 4)',
  'color:rgb(255, 53, 3)',
  'color:rgb(220, 29, 4)',
  '',
  'color:rgb(220, 29, 4)',
  '',
  'color:rgb(255, 53, 3)',
  'color:rgb(220, 29, 4)',
  '',
  'color:rgb(220, 29, 4)',
  '',
  'color:rgb(220, 29, 4)',
  '',
  'color:rgb(220, 29, 4)',
  '',
  'color:rgb(220, 29, 4)',
  '',
  'color:rgb(220, 29, 4)',
  '',
] as const;

function hasStartupBannerBeenShown(): boolean {
  return globalThis.__furnaceStartupBannerShown === true;
}

function markStartupBannerShown(): void {
  globalThis.__furnaceStartupBannerShown = true;
}

/** Logs the Furnace ASCII banner once per JS runtime. */
export function logStartupConsoleBanner(): void {
  if (hasStartupBannerBeenShown()) {
    return;
  }

  markStartupBannerShown();

  if (typeof console === 'undefined' || typeof console.log !== 'function') {
    return;
  }

  console.log(STARTUP_BANNER_FORMAT, ...STARTUP_BANNER_STYLES);
}
