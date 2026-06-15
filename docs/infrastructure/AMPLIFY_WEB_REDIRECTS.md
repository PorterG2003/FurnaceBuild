# Amplify Hosting – Redirects for Web (SPA + /auth)

The web app is an Expo SPA. Configure these **Rewrites and redirects** in the Amplify Console so `/auth` and `/auth/` work and deep links don’t 404.

## Where to set it

**Amplify Console** → your app → **Hosting** → **Rewrites and redirects** → edit (or add rules via the JSON editor).

## Rules to add (order matters)

1. **Trailing slash fix (stops `GET /auth/` 404)**  
   - **Source:** `/auth/`  
   - **Target:** `/auth`  
   - **Type:** 302 (temporary redirect)

2. **SPA fallback**  
   Do **not** use only `/<*>` → `/index.html` — that rewrite also catches `/manifest.json`, icons, and `sw.js`, so the PWA gets HTML instead of assets. Prefer the regex rule below (from [AWS SPA examples](https://docs.aws.amazon.com/amplify/latest/userguide/redirect-rewrite-examples.html#redirects-for-single-page-web-apps-spa)), optionally with explicit `/manifest.json` and `/sw.js` lines first if your console still rewrites them.

## JSON (for Amplify JSON editor)

Canonical copy in repo: [`amplifyCustomRules.json`](../../amplifyCustomRules.json). Apply to the hosting app:

```bash
aws amplify update-app --app-id d1jtp0rz0l9mcn --region us-west-2 \
  --custom-rules file://amplifyCustomRules.json
```

```json
[
  {
    "source": "/auth/",
    "target": "/auth",
    "status": "302",
    "condition": null
  },
  {
    "source": "/manifest.json",
    "target": "/manifest.json",
    "status": "200",
    "condition": null
  },
  {
    "source": "/sw.js",
    "target": "/sw.js",
    "status": "200",
    "condition": null
  },
  {
    "source": "</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|mjs|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>",
    "target": "/index.html",
    "status": "200",
    "condition": null
  }
]
```

## Flux public pages (`/p/{slug}`)

Amplify adds a trailing slash when serving SPA paths (`/p/acme` → `/p/acme/`). That left expo-router with an **empty `slug` param**, so live pages showed **Page not found** without hitting Supabase. The app normalizes this in `app/p/_layout.tsx` and resolves the slug from the pathname in `app/p/[slug].tsx`. Amplify does not allow a wildcard redirect like `/p/<*>/` → `/p/<*>`.

## Why this matters

- **PWA / manifest / icons:** A bare `/<*>` → `index.html` rewrite breaks `/manifest.json` and static images unless they are excluded (see above).
- **`GET /auth/` 404:** Something (user, bookmark, or Supabase redirect) can request `/auth/`. The app route is `/auth`; without a redirect, the host may 404 for `/auth/`.
- **Forgot password:** Reset emails use a `redirectTo` URL. If that URL or Supabase’s redirect uses `/auth/`, the user can hit the 404 when opening the link. Redirecting `/auth/` → `/auth` fixes that.
- **`runtime.lastError: The message port closed before a response was received`** is from a **browser extension** (e.g. password manager), not the app. It can be ignored.

## Production env and Supabase

- Set **EXPO_PUBLIC_APP_URL** in Amplify (e.g. `https://build.getfurnace.io`) so forgot-password redirect is `https://build.getfurnace.io/auth` (no trailing slash).
- In **Supabase Dashboard** → Authentication → URL configuration, add `https://build.getfurnace.io/auth` to **Redirect URLs**.
- **Auth emails (forgot password, confirmations, etc.):** Configure **SMTP** for the **production** Supabase project. Dashboard → **Project settings** → **Auth** → **SMTP**. Without this, auth emails are not sent (Supabase only queues them). Local dev can use Inbucket; production needs a real SMTP provider (e.g. SendGrid, Resend, SES).
