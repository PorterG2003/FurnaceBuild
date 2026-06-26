/** Tooltip copy for account-level webhook settings (`ConfigureWebhookModal`). */
export const ACCOUNT_WEBHOOK_FIELD_HELP = {
  endpointUrl:
    'HTTPS URL where Furnace sends POST requests when events occur. Your endpoint should return any 2xx response. Leave empty to disable webhooks.',
  signingSecret:
    'Optional. Signs each payload in the X-Furnace-Signature header (HMAC-SHA256). Most no-code tools can ignore this.',
  enabledEvents:
    'Event types Furnace will deliver to your endpoint. If none are selected, all event types are sent. Select only the types you want to receive.',
} as const;

/** Tooltip copy for campaign webhook overrides (`CampaignWebhookOverrideModal`). */
export const CAMPAIGN_WEBHOOK_FIELD_HELP = {
  overrideUrl:
    'Replaces the account webhook URL for this campaign only. Leave empty to use the account default.',
  overrideSigningSecret:
    "Optional signing secret for this campaign's webhook deliveries only. When the URL is empty (inheriting the account URL), the account signing secret is used.",
  overrideEvents:
    "Limits which events are sent when this campaign uses its own override URL. Leave empty to inherit the account's enabled events list.",
} as const;
