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

Flux public pages should support both `/p/acme` and `/p/acme/` in-app without a redirect dependency. The current implementation should keep hosting simple and let the route itself accept either URL form:

- **`public/index.html`** — uses `history.replaceState(...)` to strip a trailing slash from `/p/{slug}/` before React mounts, avoiding a second document request
- **`app/p/[...slug].tsx`** — catch-all route resolves exactly one slug segment and rejects nested non-page URLs
- **`lib/web/fluxPublicPageSlug.ts`** — normalizes exactly one slug segment and falls back to parsing the browser pathname
- **`app/_layout.tsx`** + **`components/web/WebInstallGate.tsx`** — use the current browser pathname consistently when deciding whether Flux public pages should bypass the normal app boot/install gate

Avoid full-page slash normalization for `/p/*` in `public/index.html`; hard navigations can loop if a host/browser preserves the opposite slash form. Amplify also cannot express `/p/<slug>/` → `/p/<slug>` redirects (wildcards cannot precede a trailing `/`).

## Why this matters

- **PWA / manifest / icons:** A bare `/<*>` → `index.html` rewrite breaks `/manifest.json` and static images unless they are excluded (see above).
- **`GET /auth/` 404:** Something (user, bookmark, or Supabase redirect) can request `/auth/`. The app route is `/auth`; without a redirect, the host may 404 for `/auth/`.
- **Forgot password:** Reset emails use a `redirectTo` URL. If that URL or Supabase’s redirect uses `/auth/`, the user can hit the 404 when opening the link. Redirecting `/auth/` → `/auth` fixes that.
- **`runtime.lastError: The message port closed before a response was received`** is from a **browser extension** (e.g. password manager), not the app. It can be ignored.

## Production env and Supabase

- Set **EXPO_PUBLIC_APP_URL** in Amplify (e.g. `https://build.getfurnace.io`) so forgot-password redirect is `https://build.getfurnace.io/auth` (no trailing slash) and invite signup confirmation redirects to `https://build.getfurnace.io/accept-invitation/{id}`.
- In **Supabase Dashboard** → Authentication → URL configuration, add both of these to **Redirect URLs**:
  - `https://build.getfurnace.io/auth` (forgot-password / recovery)
  - `https://build.getfurnace.io/accept-invitation/*` (team-invite signup confirmation; `*` matches one path segment / the invitation UUID)
- Local `supabase/config.toml` mirrors the invite pattern as `http://localhost:8081/accept-invitation/*` in `additional_redirect_urls`.
- Supabase globs the allow list against the **full URL**. A miss falls back to the Site URL with no error — so without the `accept-invitation/*` entry, confirmation links silently land on `/` and users hit `/no-workspace` until they recover via a pending invite.
- **Auth emails (forgot password, confirmations, etc.):** Configure **SMTP** for the **production** Supabase project. Dashboard → **Project settings** → **Auth** → **SMTP**. Without this, auth emails are not sent (Supabase only queues them). Local dev can use Inbucket; production needs a real SMTP provider (e.g. SendGrid, Resend, SES).
