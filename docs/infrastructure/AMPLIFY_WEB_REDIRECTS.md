# Amplify Hosting – Redirects for Web (SPA + /auth)

The web app is an Expo SPA. Configure these **Rewrites and redirects** in the Amplify Console so `/auth` and `/auth/` work and deep links don’t 404.

## Where to set it

**Amplify Console** → your app → **Hosting** → **Rewrites and redirects** → edit (or add rules via the JSON editor).

## Rules to add (order matters)

1. **Trailing slash fix (stops `GET /auth/` 404)**  
   - **Source:** `/auth/`  
   - **Target:** `/auth`  
   - **Type:** 302 (temporary redirect)

2. **SPA fallback (so all routes serve the app)**  
   - **Source:** `/<*>`  
   - **Target:** `/index.html`  
   - **Type:** 200 (rewrite)

If you already have a catch‑all SPA rule, keep it and add only the `/auth/` → `/auth` rule.

## JSON (for Amplify JSON editor)

```json
[
  {
    "source": "/auth/",
    "target": "/auth",
    "status": "302",
    "condition": null
  },
  {
    "source": "/<*>",
    "target": "/index.html",
    "status": "200",
    "condition": null
  }
]
```

## Why this matters

- **`GET /auth/` 404:** Something (user, bookmark, or Supabase redirect) can request `/auth/`. The app route is `/auth`; without a redirect, the host may 404 for `/auth/`.
- **Forgot password:** Reset emails use a `redirectTo` URL. If that URL or Supabase’s redirect uses `/auth/`, the user can hit the 404 when opening the link. Redirecting `/auth/` → `/auth` fixes that.
- **`runtime.lastError: The message port closed before a response was received`** is from a **browser extension** (e.g. password manager), not the app. It can be ignored.

## Production env and Supabase

- Set **EXPO_PUBLIC_APP_URL** in Amplify (e.g. `https://build.getfurnace.io`) so forgot-password redirect is `https://build.getfurnace.io/auth` (no trailing slash).
- In **Supabase Dashboard** → Authentication → URL configuration, add `https://build.getfurnace.io/auth` to **Redirect URLs**.
- **Auth emails (forgot password, confirmations, etc.):** Configure **SMTP** for the **production** Supabase project. Dashboard → **Project settings** → **Auth** → **SMTP**. Without this, auth emails are not sent (Supabase only queues them). Local dev can use Inbucket; production needs a real SMTP provider (e.g. SendGrid, Resend, SES).
