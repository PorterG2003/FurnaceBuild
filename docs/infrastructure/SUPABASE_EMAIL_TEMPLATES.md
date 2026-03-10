# Supabase Auth Email Templates

Copy each **Subject** and **Body (HTML)** into your Supabase project: **Authentication** → **Email Templates**. Brand colors: Furnace orange `#F3440D`, dark `#1a1a1a`, neutral gray text.

---

## 1. Confirm signup

**Subject:**
```
Confirm your Furnace account
```

**Body (HTML):**
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirm your email</title>
</head>
<body style="margin:0; padding:0; background-color:#0f0f0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0f0f0f; min-height:100vh;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" style="max-width: 440px;">
          <tr>
            <td style="padding-bottom: 32px; text-align: center;">
              <span style="font-size: 22px; font-weight: 600; color: #ffffff; letter-spacing: -0.02em;">Furnace</span>
            </td>
          </tr>
          <tr>
            <td style="background-color: #1a1a1a; border-radius: 12px; padding: 40px 32px; border: 1px solid #2a2a2a;">
              <h1 style="margin:0 0 8px 0; font-size: 20px; font-weight: 600; color: #ffffff;">Confirm your email</h1>
              <p style="margin:0 0 24px 0; font-size: 15px; line-height: 1.5; color: #a3a3a3;">Thanks for signing up. Click the button below to verify your email and get started.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0;">
                <tr>
                  <td style="border-radius: 8px; background-color: #F3440D;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display: inline-block; padding: 14px 28px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none;">Confirm email</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 24px 0 0 0; font-size: 13px; line-height: 1.5; color: #737373;">If you didn’t create an account, you can ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding-top: 24px; text-align: center;">
              <p style="margin:0; font-size: 12px; color: #525252;">Furnace · Build</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 2. Magic link

**Subject:**
```
Your Furnace sign-in link
```

**Body (HTML):**
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in to Furnace</title>
</head>
<body style="margin:0; padding:0; background-color:#0f0f0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0f0f0f; min-height:100vh;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" style="max-width: 440px;">
          <tr>
            <td style="padding-bottom: 32px; text-align: center;">
              <span style="font-size: 22px; font-weight: 600; color: #ffffff; letter-spacing: -0.02em;">Furnace</span>
            </td>
          </tr>
          <tr>
            <td style="background-color: #1a1a1a; border-radius: 12px; padding: 40px 32px; border: 1px solid #2a2a2a;">
              <h1 style="margin:0 0 8px 0; font-size: 20px; font-weight: 600; color: #ffffff;">Sign in to Furnace</h1>
              <p style="margin:0 0 24px 0; font-size: 15px; line-height: 1.5; color: #a3a3a3;">Use the button below to sign in. This link works once and expires soon.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0;">
                <tr>
                  <td style="border-radius: 8px; background-color: #F3440D;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display: inline-block; padding: 14px 28px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none;">Sign in</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 24px 0 0 0; font-size: 13px; line-height: 1.5; color: #737373;">If you didn’t request this, you can safely ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding-top: 24px; text-align: center;">
              <p style="margin:0; font-size: 12px; color: #525252;">Furnace · Build</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 3. Reset password (recovery)

**Subject:**
```
Reset your Furnace password
```

**Body (HTML):**
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your password</title>
</head>
<body style="margin:0; padding:0; background-color:#0f0f0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0f0f0f; min-height:100vh;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" style="max-width: 440px;">
          <tr>
            <td style="padding-bottom: 32px; text-align: center;">
              <span style="font-size: 22px; font-weight: 600; color: #ffffff; letter-spacing: -0.02em;">Furnace</span>
            </td>
          </tr>
          <tr>
            <td style="background-color: #1a1a1a; border-radius: 12px; padding: 40px 32px; border: 1px solid #2a2a2a;">
              <h1 style="margin:0 0 8px 0; font-size: 20px; font-weight: 600; color: #ffffff;">Reset your password</h1>
              <p style="margin:0 0 24px 0; font-size: 15px; line-height: 1.5; color: #a3a3a3;">We received a request to reset the password for {{ .Email }}. Click below to choose a new password.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0;">
                <tr>
                  <td style="border-radius: 8px; background-color: #F3440D;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display: inline-block; padding: 14px 28px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none;">Reset password</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 24px 0 0 0; font-size: 13px; line-height: 1.5; color: #737373;">If you didn’t request this, you can ignore this email. Your password will stay the same.</p>
            </td>
          </tr>
          <tr>
            <td style="padding-top: 24px; text-align: center;">
              <p style="margin:0; font-size: 12px; color: #525252;">Furnace · Build</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 4. Invite user

**Subject:**
```
You're invited to Furnace
```

**Body (HTML):**
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're invited to Furnace</title>
</head>
<body style="margin:0; padding:0; background-color:#0f0f0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0f0f0f; min-height:100vh;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" style="max-width: 440px;">
          <tr>
            <td style="padding-bottom: 32px; text-align: center;">
              <span style="font-size: 22px; font-weight: 600; color: #ffffff; letter-spacing: -0.02em;">Furnace</span>
            </td>
          </tr>
          <tr>
            <td style="background-color: #1a1a1a; border-radius: 12px; padding: 40px 32px; border: 1px solid #2a2a2a;">
              <h1 style="margin:0 0 8px 0; font-size: 20px; font-weight: 600; color: #ffffff;">You're invited</h1>
              <p style="margin:0 0 24px 0; font-size: 15px; line-height: 1.5; color: #a3a3a3;">You’ve been invited to join Furnace. Click below to accept the invite and create your account.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0;">
                <tr>
                  <td style="border-radius: 8px; background-color: #F3440D;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display: inline-block; padding: 14px 28px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none;">Accept invite</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 24px 0 0 0; font-size: 13px; line-height: 1.5; color: #737373;">If you weren’t expecting this invite, you can ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding-top: 24px; text-align: center;">
              <p style="margin:0; font-size: 12px; color: #525252;">Furnace · Build</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 5. Change email address

**Subject:**
```
Confirm your new email address
```

**Body (HTML):**
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirm your new email</title>
</head>
<body style="margin:0; padding:0; background-color:#0f0f0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0f0f0f; min-height:100vh;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" style="max-width: 440px;">
          <tr>
            <td style="padding-bottom: 32px; text-align: center;">
              <span style="font-size: 22px; font-weight: 600; color: #ffffff; letter-spacing: -0.02em;">Furnace</span>
            </td>
          </tr>
          <tr>
            <td style="background-color: #1a1a1a; border-radius: 12px; padding: 40px 32px; border: 1px solid #2a2a2a;">
              <h1 style="margin:0 0 8px 0; font-size: 20px; font-weight: 600; color: #ffffff;">Confirm new email</h1>
              <p style="margin:0 0 24px 0; font-size: 15px; line-height: 1.5; color: #a3a3a3;">You requested to change your email to {{ .NewEmail }}. Click below to confirm.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0;">
                <tr>
                  <td style="border-radius: 8px; background-color: #F3440D;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display: inline-block; padding: 14px 28px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none;">Confirm email</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 24px 0 0 0; font-size: 13px; line-height: 1.5; color: #737373;">If you didn’t request this change, you can ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding-top: 24px; text-align: center;">
              <p style="margin:0; font-size: 12px; color: #525252;">Furnace · Build</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 6. Reauthentication (OTP)

**Subject:**
```
Your Furnace verification code
```

**Body (HTML):**
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verification code</title>
</head>
<body style="margin:0; padding:0; background-color:#0f0f0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0f0f0f; min-height:100vh;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" style="max-width: 440px;">
          <tr>
            <td style="padding-bottom: 32px; text-align: center;">
              <span style="font-size: 22px; font-weight: 600; color: #ffffff; letter-spacing: -0.02em;">Furnace</span>
            </td>
          </tr>
          <tr>
            <td style="background-color: #1a1a1a; border-radius: 12px; padding: 40px 32px; border: 1px solid #2a2a2a;">
              <h1 style="margin:0 0 8px 0; font-size: 20px; font-weight: 600; color: #ffffff;">Verification code</h1>
              <p style="margin:0 0 20px 0; font-size: 15px; line-height: 1.5; color: #a3a3a3;">Use this code to continue:</p>
              <p style="margin:0; font-size: 28px; font-weight: 600; letter-spacing: 0.2em; color: #F3440D;">{{ .Token }}</p>
              <p style="margin: 20px 0 0 0; font-size: 13px; line-height: 1.5; color: #737373;">This code expires soon. If you didn’t request it, you can ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding-top: 24px; text-align: center;">
              <p style="margin:0; font-size: 12px; color: #525252;">Furnace · Build</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 7. Password changed (notification)

**Subject:**
```
Your Furnace password was changed
```

**Body (HTML):**
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password changed</title>
</head>
<body style="margin:0; padding:0; background-color:#0f0f0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0f0f0f; min-height:100vh;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" style="max-width: 440px;">
          <tr>
            <td style="padding-bottom: 32px; text-align: center;">
              <span style="font-size: 22px; font-weight: 600; color: #ffffff; letter-spacing: -0.02em;">Furnace</span>
            </td>
          </tr>
          <tr>
            <td style="background-color: #1a1a1a; border-radius: 12px; padding: 40px 32px; border: 1px solid #2a2a2a;">
              <h1 style="margin:0 0 8px 0; font-size: 20px; font-weight: 600; color: #ffffff;">Password changed</h1>
              <p style="margin:0; font-size: 15px; line-height: 1.5; color: #a3a3a3;">The password for {{ .Email }} was recently changed. If you made this change, you’re all set.</p>
              <p style="margin: 16px 0 0 0; font-size: 13px; line-height: 1.5; color: #737373;">If you didn’t change it, please reset your password and contact support.</p>
            </td>
          </tr>
          <tr>
            <td style="padding-top: 24px; text-align: center;">
              <p style="margin:0; font-size: 12px; color: #525252;">Furnace · Build</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 8. Email address changed (notification)

**Subject:**
```
Your Furnace email address was changed
```

**Body (HTML):**
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email address changed</title>
</head>
<body style="margin:0; padding:0; background-color:#0f0f0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0f0f0f; min-height:100vh;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" style="max-width: 440px;">
          <tr>
            <td style="padding-bottom: 32px; text-align: center;">
              <span style="font-size: 22px; font-weight: 600; color: #ffffff; letter-spacing: -0.02em;">Furnace</span>
            </td>
          </tr>
          <tr>
            <td style="background-color: #1a1a1a; border-radius: 12px; padding: 40px 32px; border: 1px solid #2a2a2a;">
              <h1 style="margin:0 0 8px 0; font-size: 20px; font-weight: 600; color: #ffffff;">Email address changed</h1>
              <p style="margin:0; font-size: 15px; line-height: 1.5; color: #a3a3a3;">The email for your account was changed from {{ .OldEmail }} to {{ .Email }}.</p>
              <p style="margin: 16px 0 0 0; font-size: 13px; line-height: 1.5; color: #737373;">If you didn’t make this change, please contact support.</p>
            </td>
          </tr>
          <tr>
            <td style="padding-top: 24px; text-align: center;">
              <p style="margin:0; font-size: 12px; color: #525252;">Furnace · Build</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## Paste instructions

1. Supabase Dashboard → **Authentication** → **Email Templates**.
2. For each template type (Confirm signup, Magic link, Reset password, etc.):
   - Set **Subject** to the line under “Subject:” above.
   - Paste the full **Body** HTML (including `<!DOCTYPE>` and `<html>…</html>`) into the body editor.
3. Save. Ensure **SMTP** is configured for the project (Project settings → Auth → SMTP) or emails won’t send.

All templates use `{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .Email }}`, etc. Do not remove these; Supabase replaces them when sending.
