import {
  API_KEY_PREFIX,
  BULK_ASYNC_LIMIT,
  BULK_SYNC_LIMIT,
  DEFAULT_PAGE_SIZE,
  IMPORT_JOB_OPERATIONS,
  MAX_ASYNC_JOBS_PER_ACCOUNT,
  MAX_PAGE_SIZE,
  RATE_LIMIT_REQUESTS_PER_MINUTE,
} from './constants.js';

export function schemaRef(name: string) {
  return { $ref: `#/components/schemas/${name}` };
}

export function parameterRef(name: string) {
  return { $ref: `#/components/parameters/${name}` };
}

export function responseRef(name: string) {
  return { $ref: `#/components/responses/${name}` };
}

function rateLimitHeaders() {
  return {
    'X-RateLimit-Limit': { $ref: '#/components/headers/XRateLimitLimit' },
    'X-RateLimit-Remaining': { $ref: '#/components/headers/XRateLimitRemaining' },
    'X-RateLimit-Reset': { $ref: '#/components/headers/XRateLimitReset' },
  };
}

export function buildClientApiComponents() {
  return {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'API Key',
        description: `Use an account API key in the Authorization header: \`Authorization: Bearer ${API_KEY_PREFIX}...\`.`,
      },
    },
    headers: {
      XRateLimitLimit: {
        description: `Maximum requests allowed in the current minute window. Furnace currently allows ${RATE_LIMIT_REQUESTS_PER_MINUTE} requests per account per minute.`,
        schema: { type: 'string', example: String(RATE_LIMIT_REQUESTS_PER_MINUTE) },
      },
      XRateLimitRemaining: {
        description: 'Remaining requests in the current minute window.',
        schema: { type: 'string', example: '199' },
      },
      XRateLimitReset: {
        description: 'Unix epoch seconds when the current rate-limit window resets.',
        schema: { type: 'string', example: '1716316860' },
      },
    },
    parameters: {
      CampaignId: {
        name: 'id',
        in: 'path',
        required: true,
        description: 'Campaign id.',
        schema: { type: 'string', format: 'uuid' },
      },
      LeadId: {
        name: 'leadId',
        in: 'path',
        required: true,
        description: 'Lead id.',
        schema: { type: 'string', format: 'uuid' },
      },
      JobId: {
        name: 'id',
        in: 'path',
        required: true,
        description: 'Async import job id.',
        schema: { type: 'string', format: 'uuid' },
      },
      MailboxId: {
        name: 'id',
        in: 'path',
        required: true,
        description: 'Mailbox id.',
        schema: { type: 'string', format: 'uuid' },
      },
      ThreadId: {
        name: 'id',
        in: 'path',
        required: true,
        description: 'Inbox thread id.',
        schema: { type: 'string', format: 'uuid' },
      },
      BlockListId: {
        name: 'id',
        in: 'path',
        required: true,
        description: 'Block-list entry id.',
        schema: { type: 'string', format: 'uuid' },
      },
      Limit: {
        name: 'limit',
        in: 'query',
        description: `Number of rows to return. Defaults to ${DEFAULT_PAGE_SIZE}; maximum ${MAX_PAGE_SIZE}.`,
        schema: {
          type: 'integer',
          minimum: 0,
          default: DEFAULT_PAGE_SIZE,
          maximum: MAX_PAGE_SIZE,
        },
      },
      Offset: {
        name: 'offset',
        in: 'query',
        description: 'Zero-based offset for pagination.',
        schema: {
          type: 'integer',
          minimum: 0,
          default: 0,
        },
      },
      Search: {
        name: 'q',
        in: 'query',
        description: 'Case-insensitive search term.',
        schema: { type: 'string' },
      },
      CampaignStatus: {
        name: 'status',
        in: 'query',
        description: 'Campaign status filter.',
        schema: {
          type: 'string',
          enum: ['draft', 'running', 'paused', 'stopped'],
        },
      },
      CampaignTagIds: {
        name: 'tag_ids',
        in: 'query',
        description: 'Comma-separated campaign tag ids. Returns campaigns that have any of the listed tags.',
        schema: { type: 'string', example: 'uuid-1,uuid-2' },
      },
      CampaignTagId: {
        name: 'id',
        in: 'path',
        required: true,
        description: 'Campaign tag id.',
        schema: { type: 'string', format: 'uuid' },
      },
      MailboxTagIds: {
        name: 'tag_ids',
        in: 'query',
        description: 'Comma-separated mailbox tag ids. Returns mailboxes that have any of the listed tags.',
        schema: { type: 'string', example: 'uuid-1,uuid-2' },
      },
      MailboxTagId: {
        name: 'id',
        in: 'path',
        required: true,
        description: 'Mailbox tag id.',
        schema: { type: 'string', format: 'uuid' },
      },
      GlobalLeadId: {
        name: 'globalLeadId',
        in: 'path',
        required: true,
        description: 'Stable account-scoped person id (SHA-256 of normalized email).',
        schema: { type: 'string' },
      },
      LeadListId: {
        name: 'id',
        in: 'path',
        required: true,
        description: 'Saved lead list id.',
        schema: { type: 'string', format: 'uuid' },
      },
      PeopleSearch: {
        name: 'q',
        in: 'query',
        description: 'Search people by email or name.',
        schema: { type: 'string' },
      },
      PeopleSort: {
        name: 'sort',
        in: 'query',
        description: 'Sort column for the people explorer.',
        schema: { type: 'string', default: 'latest_activity' },
      },
      PeopleSortDirection: {
        name: 'sort_dir',
        in: 'query',
        description: 'Sort direction.',
        schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
      },
      GlobalLeadIdsQuery: {
        name: 'global_lead_ids',
        in: 'query',
        description: 'Comma-separated global lead ids filter.',
        schema: { type: 'string' },
      },
      CampaignIdsQuery: {
        name: 'campaign_ids',
        in: 'query',
        description: 'Comma-separated campaign ids filter.',
        schema: { type: 'string' },
      },
      IncludeDeletedCampaigns: {
        name: 'include_deleted',
        in: 'query',
        description: 'When true, includes campaigns with `deleted_at` set.',
        schema: { type: 'boolean', default: false },
      },
      CampaignFilter: {
        name: 'campaign_id',
        in: 'query',
        description: 'Filter inbox threads to a single campaign.',
        schema: { type: 'string', format: 'uuid' },
      },
      MailboxFilter: {
        name: 'mailbox_id',
        in: 'query',
        description: 'Filter inbox threads to a single mailbox.',
        schema: { type: 'string', format: 'uuid' },
      },
      MessageJobId: {
        name: 'id',
        in: 'path',
        required: true,
        description: 'Outbound inbox message job id returned by reply or forward endpoints.',
        schema: { type: 'string', format: 'uuid' },
      },
      UnreadOnly: {
        name: 'unread_only',
        in: 'query',
        description: 'When true, returns only threads with unread received messages.',
        schema: { type: 'boolean', default: false },
      },
      ConversationStatusFilter: {
        name: 'conversation_status',
        in: 'query',
        description: 'Filter threads by conversation status.',
        schema: { type: 'string', enum: ['open', 'closed'] },
      },
      ThreadCategoryFilter: {
        name: 'category',
        in: 'query',
        description: 'Filter threads by category. Use `no_category` for uncategorized threads.',
        schema: {
          type: 'string',
          enum: ['Interested', 'Neutral', 'Not Interested', 'Auto Reply', 'no_category'],
        },
      },
      ThreadTagIdsFilter: {
        name: 'tag_ids',
        in: 'query',
        description: 'Comma-separated thread tag ids. Returns threads tagged with any listed tag.',
        schema: { type: 'string', example: 'uuid-1,uuid-2' },
      },
      DateFrom: {
        name: 'date_from',
        in: 'query',
        description: 'Inclusive ISO-8601 timestamp filter on `last_message_at`.',
        schema: { type: 'string', format: 'date-time' },
      },
      DateTo: {
        name: 'date_to',
        in: 'query',
        description: 'Inclusive ISO-8601 timestamp filter on `last_message_at`.',
        schema: { type: 'string', format: 'date-time' },
      },
      HasReplyOnly: {
        name: 'has_reply_only',
        in: 'query',
        description: 'When true (default), returns only threads with at least one inbound reply.',
        schema: { type: 'boolean', default: true },
      },
      StartDate: {
        name: 'start_date',
        in: 'query',
        description: 'Inclusive start date in `YYYY-MM-DD` format.',
        schema: { type: 'string', format: 'date' },
      },
      EndDate: {
        name: 'end_date',
        in: 'query',
        description: 'Inclusive end date in `YYYY-MM-DD` format.',
        schema: { type: 'string', format: 'date' },
      },
      IdempotencyKey: {
        name: 'Idempotency-Key',
        in: 'header',
        description: 'Optional idempotency key for create and bulk lead imports.',
        schema: { type: 'string' },
      },
    },
    responses: {
      UnauthorizedError: {
        description: 'Missing, invalid, revoked, or expired API key.',
        headers: rateLimitHeaders(),
        content: {
          'application/json': {
            schema: schemaRef('Error'),
            example: {
              error: {
                type: 'authentication_error',
                code: 'invalid_api_key',
                message: 'A valid Furnace API key is required',
              },
            },
          },
        },
      },
      ForbiddenError: {
        description: 'The authenticated account may read the resource but cannot perform this action.',
        headers: rateLimitHeaders(),
        content: {
          'application/json': {
            schema: schemaRef('Error'),
            example: {
              error: {
                type: 'permission_error',
                code: 'smartlead_read_only',
                message: 'Smartlead campaigns are read-only via the API',
              },
            },
          },
        },
      },
      NotFoundError: {
        description: 'The requested resource does not exist in the API key account scope.',
        headers: rateLimitHeaders(),
        content: {
          'application/json': {
            schema: schemaRef('Error'),
            example: {
              error: {
                type: 'invalid_request_error',
                code: 'campaign_not_found',
                message: 'Campaign not found',
              },
            },
          },
        },
      },
      RateLimitError: {
        description: 'The account exceeded the current rate limit window.',
        headers: rateLimitHeaders(),
        content: {
          'application/json': {
            schema: schemaRef('Error'),
            example: {
              error: {
                type: 'rate_limit_error',
                code: 'rate_limit_exceeded',
                message: 'Rate limit exceeded for this account',
              },
            },
          },
        },
      },
      ValidationError: {
        description: 'The request body or parameters failed validation.',
        headers: rateLimitHeaders(),
        content: {
          'application/json': {
            schema: schemaRef('Error'),
            example: {
              error: {
                type: 'invalid_request_error',
                code: 'missing_email',
                message: 'Lead email is required',
                param: 'email',
              },
            },
          },
        },
      },
      InternalError: {
        description: 'Unexpected server-side error.',
        headers: rateLimitHeaders(),
        content: {
          'application/json': {
            schema: schemaRef('Error'),
            example: {
              error: {
                type: 'api_error',
                code: 'internal_error',
                message: 'Internal server error',
              },
            },
          },
        },
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: [
                  'invalid_request_error',
                  'authentication_error',
                  'permission_error',
                  'rate_limit_error',
                  'api_error',
                ],
              },
              code: { type: 'string' },
              message: { type: 'string' },
              param: { type: 'string' },
            },
            required: ['type', 'code', 'message'],
          },
        },
        required: ['error'],
      },
      HealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'error'] },
          db: { type: 'string', enum: ['ok', 'error'] },
        },
        required: ['status', 'db'],
      },
      DeleteResult: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          deleted: { type: 'boolean' },
        },
        required: ['id', 'deleted'],
      },
      CampaignTag: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          color: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'name', 'created_at'],
      },
      CampaignTagCreate: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          color: { type: 'string', nullable: true },
        },
        required: ['name'],
        additionalProperties: false,
      },
      CampaignTagUpdate: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          color: { type: 'string', nullable: true },
        },
        additionalProperties: false,
      },
      CampaignTagResponse: {
        type: 'object',
        properties: {
          data: schemaRef('CampaignTag'),
        },
        required: ['data'],
      },
      CampaignTagListResponse: {
        type: 'object',
        properties: {
          data: { type: 'array', items: schemaRef('CampaignTag') },
        },
        required: ['data'],
      },
      Campaign: {
        type: 'object',
        description: 'Campaign row as returned by the Furnace backend.',
        properties: {
          id: { type: 'string', format: 'uuid' },
          account_id: { type: 'string', format: 'uuid', nullable: true },
          bucket_id: { type: 'string', format: 'uuid', nullable: true },
          name: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['draft', 'running', 'paused', 'stopped'] },
          source: {
            type: 'string',
            description: 'Campaign source. `smartlead` campaigns can be read but not mutated through this API.',
            examples: ['manual'],
          },
          flow_data: { $ref: '#/components/schemas/CampaignFlow' },
          schedule: { type: 'object', additionalProperties: true, nullable: true },
          sending_interval_seconds: { type: 'number', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time', nullable: true },
          deleted_at: { type: 'string', format: 'date-time', nullable: true },
          tags: {
            type: 'array',
            items: schemaRef('CampaignTag'),
            description: 'Campaign tags assigned to this campaign.',
          },
        },
        required: ['id', 'status', 'created_at'],
        additionalProperties: true,
      },
      CampaignFlow: {
        type: 'object',
        description: 'Flow graph definition for the campaign.',
        properties: {
          nodes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                type: { type: 'string', nullable: true },
                data: { type: 'object', additionalProperties: true, nullable: true },
              },
              additionalProperties: true,
            },
          },
          edges: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
            },
          },
        },
        additionalProperties: true,
      },
      CampaignUpdate: {
        type: 'object',
        description: 'Mutable campaign fields. Mailbox ids can replace the full set or be incrementally added and removed.',
        properties: {
          name: { type: 'string' },
          schedule: { type: 'object', additionalProperties: true },
          sending_interval_seconds: { type: 'number' },
          mailbox_ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
          },
          add_mailbox_ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
          },
          remove_mailbox_ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
          },
          tag_ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            description: 'Replace all tag assignments on the campaign.',
          },
          add_tag_ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
          },
          remove_tag_ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
          },
        },
        additionalProperties: false,
      },
      CampaignStatusResult: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['paused', 'stopped', 'running'] },
        },
        required: ['id', 'status'],
      },
      LeadFields: {
        type: 'object',
        properties: {
          standard: {
            type: 'array',
            items: { type: 'string' },
          },
          custom: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['standard', 'custom'],
      },
      LeadFieldCreate: {
        type: 'object',
        properties: {
          key: { type: 'string' },
        },
        required: ['key'],
      },
      LeadFieldResult: {
        type: 'object',
        properties: {
          key: { type: 'string' },
        },
        required: ['key'],
      },
      Lead: {
        type: 'object',
        description: 'Lead row scoped to a campaign.',
        properties: {
          id: { type: 'string', format: 'uuid' },
          campaign_id: { type: 'string', format: 'uuid' },
          account_id: { type: 'string', format: 'uuid', nullable: true },
          global_lead_id: {
            type: 'string',
            description: 'Stable account-scoped person id (SHA-256 of normalized email). Used for enrollment pause/resume and bulk membership APIs.',
          },
          email: { type: 'string', format: 'email' },
          name: { type: 'string', nullable: true },
          first_name: { type: 'string', nullable: true },
          last_name: { type: 'string', nullable: true },
          company_name: { type: 'string', nullable: true },
          website: { type: 'string', nullable: true },
          linkedin_url: { type: 'string', nullable: true },
          company_linkedin_url: { type: 'string', nullable: true },
          custom_lead_data: { type: 'object', additionalProperties: true },
          source: { type: 'string', examples: ['api'] },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time', nullable: true },
          deleted_at: { type: 'string', format: 'date-time', nullable: true },
        },
        required: ['id', 'campaign_id', 'email', 'created_at'],
        additionalProperties: true,
      },
      LeadCreate: {
        type: 'object',
        description: 'Create or upsert a lead. `email` is required. When the campaign defines custom lead fields, every key must be present in `custom_lead_data`.',
        properties: {
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          company_name: { type: 'string' },
          website: { type: 'string' },
          linkedin_url: { type: 'string' },
          company_linkedin_url: { type: 'string' },
          custom_lead_data: {
            type: 'object',
            additionalProperties: true,
          },
        },
        required: ['email'],
        additionalProperties: false,
      },
      LeadUpdate: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          name: { type: 'string', nullable: true },
          first_name: { type: 'string', nullable: true },
          last_name: { type: 'string', nullable: true },
          company_name: { type: 'string', nullable: true },
          website: { type: 'string', nullable: true },
          linkedin_url: { type: 'string', nullable: true },
          company_linkedin_url: { type: 'string', nullable: true },
          custom_lead_data: {
            type: 'object',
            additionalProperties: true,
          },
        },
        additionalProperties: false,
      },
      LeadUpsertResult: {
        type: 'object',
        properties: {
          data: schemaRef('Lead'),
          created: { type: 'boolean' },
        },
        required: ['data', 'created'],
      },
      BulkLeadsRequest: {
        type: 'object',
        properties: {
          leads: {
            type: 'array',
            minItems: 1,
            maxItems: BULK_SYNC_LIMIT,
            items: schemaRef('LeadCreate'),
          },
        },
        required: ['leads'],
      },
      AsyncBulkLeadsRequest: {
        type: 'object',
        properties: {
          leads: {
            type: 'array',
            minItems: 1,
            maxItems: BULK_ASYNC_LIMIT,
            items: schemaRef('LeadCreate'),
          },
        },
        required: ['leads'],
      },
      BulkLeadsResult: {
        type: 'object',
        properties: {
          imported: { type: 'integer' },
          incomplete: {
            type: 'integer',
            description: 'Leads imported but missing one or more required custom (personalization) fields.',
          },
          failed: { type: 'integer' },
          errors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: { type: 'integer' },
                message: { type: 'string' },
              },
              required: ['index', 'message'],
            },
          },
        },
        required: ['imported', 'incomplete', 'failed', 'errors'],
      },
      ImportJob: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          account_id: { type: 'string', format: 'uuid' },
          campaign_id: { type: 'string', format: 'uuid', nullable: true },
          created_by_api_key_id: { type: 'string', format: 'uuid', nullable: true },
          status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed'] },
          progress: { type: 'integer', minimum: 0, maximum: 100 },
          cursor: { type: 'integer', minimum: 0 },
          input: {
            type: 'object',
            additionalProperties: true,
            description: 'Includes required `operation` and scope fields (`global_lead_ids`, `list_id`, or `leads`).',
          },
          result: { type: 'object', additionalProperties: true },
          errors: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
          },
          started_at: { type: 'string', format: 'date-time', nullable: true },
          completed_at: { type: 'string', format: 'date-time', nullable: true },
          created_at: { type: 'string', format: 'date-time', nullable: true },
          updated_at: { type: 'string', format: 'date-time', nullable: true },
        },
        required: ['id', 'status', 'input', 'result', 'errors'],
        additionalProperties: true,
      },
      ImportJobCreate: {
        type: 'object',
        description: 'Create an async bulk job. Poll `GET /v1/jobs/{id}` for completion.',
        properties: {
          operation: { type: 'string', enum: [...IMPORT_JOB_OPERATIONS] },
          campaign_id: { type: 'string', format: 'uuid', nullable: true },
          global_lead_ids: { type: 'array', items: { type: 'string' } },
          list_id: { type: 'string', format: 'uuid' },
          leads: {
            type: 'array',
            maxItems: BULK_ASYNC_LIMIT,
            items: schemaRef('LeadCreate'),
          },
        },
        required: ['operation'],
        additionalProperties: false,
      },
      Mailbox: {
        type: 'object',
        description: 'Mailbox row with sensitive IMAP/SMTP passwords removed from the response.',
        properties: {
          id: { type: 'string', format: 'uuid' },
          account_id: { type: 'string', format: 'uuid', nullable: true },
          email: { type: 'string', format: 'email', nullable: true },
          display_name: { type: 'string', nullable: true },
          provider: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time', nullable: true },
          updated_at: { type: 'string', format: 'date-time', nullable: true },
          tags: {
            type: 'array',
            items: schemaRef('MailboxTag'),
            description: 'Mailbox tags assigned to this mailbox.',
          },
        },
        required: ['id'],
        additionalProperties: true,
      },
      MailboxTag: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          color: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'name', 'created_at'],
      },
      MailboxTagCreate: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          color: { type: 'string', nullable: true },
        },
        required: ['name'],
        additionalProperties: false,
      },
      MailboxTagUpdate: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          color: { type: 'string', nullable: true },
        },
        additionalProperties: false,
      },
      MailboxTagResponse: {
        type: 'object',
        properties: {
          data: schemaRef('MailboxTag'),
        },
        required: ['data'],
      },
      MailboxTagListResponse: {
        type: 'object',
        properties: {
          data: { type: 'array', items: schemaRef('MailboxTag') },
        },
        required: ['data'],
      },
      MailboxUpdate: {
        type: 'object',
        description: 'Mutable mailbox fields currently support tag assignment only.',
        properties: {
          tag_ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            description: 'Replace all tag assignments on the mailbox.',
          },
          add_tag_ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
          },
          remove_tag_ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
          },
        },
        additionalProperties: false,
      },
      Thread: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          account_id: { type: 'string', format: 'uuid' },
          campaign_id: { type: 'string', format: 'uuid', nullable: true },
          mailbox_id: { type: 'string', format: 'uuid', nullable: true },
          subject: { type: 'string', nullable: true },
          last_message_at: { type: 'string', format: 'date-time', nullable: true },
        },
        required: ['id', 'account_id'],
        additionalProperties: true,
      },
      Message: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          thread_id: { type: 'string', format: 'uuid' },
          direction: { type: 'string', enum: ['sent', 'received'] },
          subject: { type: 'string', nullable: true },
          body_text: { type: 'string', nullable: true },
          body_html: { type: 'string', nullable: true },
          from_email: { type: 'string', format: 'email', nullable: true },
          from_name: { type: 'string', nullable: true },
          to_email: { type: 'string', format: 'email', nullable: true },
          received_at: { type: 'string', format: 'date-time', nullable: true },
        },
        required: ['id', 'thread_id'],
        additionalProperties: true,
      },
      ReplyRequest: {
        type: 'object',
        description: 'Create a reply job for a thread message. When omitted, subject and recipient fields fall back to the target message.',
        properties: {
          in_reply_to_message_id: {
            type: 'string',
            format: 'uuid',
            description: 'Message to reply to. Defaults to the latest message in the thread.',
          },
          subject: { type: 'string' },
          body_text: { type: 'string' },
          body_html: { type: 'string' },
          to_email: { type: 'string', format: 'email' },
          to_name: { type: 'string' },
          cc: {
            type: 'array',
            items: { type: 'string', format: 'email' },
          },
        },
        additionalProperties: false,
      },
      ForwardRequest: {
        type: 'object',
        description: 'Create a forward job for a specific message in the thread.',
        properties: {
          forward_message_id: { type: 'string', format: 'uuid' },
          subject: { type: 'string' },
          body_text: { type: 'string' },
          body_html: { type: 'string' },
          to_email: { type: 'string', format: 'email' },
          to_name: { type: 'string' },
          cc: {
            type: 'array',
            items: { type: 'string', format: 'email' },
          },
        },
        required: ['forward_message_id', 'to_email'],
        additionalProperties: false,
      },
      ThreadUpdate: {
        type: 'object',
        description: 'Partial thread update. All fields are optional.',
        properties: {
          category: {
            type: 'string',
            nullable: true,
            enum: ['Interested', 'Neutral', 'Not Interested', 'Auto Reply', null],
          },
          conversation_status: { type: 'string', enum: ['open', 'closed'] },
          read: {
            type: 'boolean',
            description: 'When true, marks all received messages in the thread as read.',
          },
        },
        additionalProperties: false,
      },
      MessageJob: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          status: { type: 'string' },
          message_type: { type: 'string', nullable: true },
          thread_id: { type: 'string', format: 'uuid', nullable: true },
          error_message: { type: 'string', nullable: true },
          scheduled_at: { type: 'string', format: 'date-time', nullable: true },
          send_wait_reason: { type: 'string', nullable: true },
          status_reason: { type: 'string', nullable: true },
        },
        required: ['id', 'status'],
        additionalProperties: false,
      },
      OutOfOfficeUpdate: {
        type: 'object',
        properties: {
          resume_at: { type: 'string', format: 'date-time', nullable: true },
          resume_mode: {
            type: 'string',
            enum: ['scheduled', 'instant', 'none'],
            default: 'scheduled',
          },
        },
        additionalProperties: false,
      },
      OutOfOfficeResponse: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              thread: schemaRef('Thread'),
              result: { type: 'string' },
            },
            required: ['thread', 'result'],
          },
        },
        required: ['data'],
      },
      ReplaceLeadRequest: {
        type: 'object',
        properties: {
          new_email: { type: 'string', format: 'email' },
          new_name: { type: 'string', nullable: true },
          new_first_name: { type: 'string', nullable: true },
          new_last_name: { type: 'string', nullable: true },
          new_phone_number: { type: 'string', nullable: true },
          reason: { type: 'string', nullable: true },
          reason_note: { type: 'string', nullable: true },
          source_message_id: { type: 'string', format: 'uuid', nullable: true },
          forward_message_id: { type: 'string', format: 'uuid', nullable: true },
        },
        required: ['new_email'],
        additionalProperties: false,
      },
      ReplaceLeadResult: {
        type: 'object',
        properties: {
          replacement_id: { type: 'string', format: 'uuid' },
          new_lead_id: { type: 'string', format: 'uuid' },
          enrollment_id: { type: 'string', format: 'uuid', nullable: true },
          forward_job_id: { type: 'string', format: 'uuid', nullable: true },
        },
        required: ['replacement_id', 'new_lead_id'],
      },
      ThreadTag: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          account_id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          color: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time', nullable: true },
        },
        required: ['id', 'account_id', 'name'],
        additionalProperties: true,
      },
      ThreadTagAssignmentRequest: {
        type: 'object',
        properties: {
          tag_id: { type: 'string', format: 'uuid' },
        },
        required: ['tag_id'],
        additionalProperties: false,
      },
      ThreadTagAssignmentResult: {
        type: 'object',
        properties: {
          thread_id: { type: 'string', format: 'uuid' },
          tag_id: { type: 'string', format: 'uuid' },
          removed: { type: 'boolean' },
        },
        required: ['thread_id', 'tag_id'],
      },
      ReplyJobResult: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
        required: ['id'],
      },
      BlockListEntry: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          account_id: { type: 'string', format: 'uuid' },
          value: { type: 'string' },
          type: { type: 'string', enum: ['email', 'domain'] },
          reason: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time', nullable: true },
        },
        required: ['id', 'account_id', 'value', 'type'],
        additionalProperties: true,
      },
      BlockListCreate: {
        type: 'object',
        properties: {
          value: { type: 'string' },
          type: { type: 'string', enum: ['email', 'domain'] },
          reason: { type: 'string', nullable: true },
        },
        required: ['value', 'type'],
        additionalProperties: false,
      },
      CampaignStatsDaily: {
        type: 'object',
        properties: {
          date: { type: 'string', format: 'date' },
          sent: { type: 'number' },
          replied: { type: 'number' },
          positiveReply: { type: 'number' },
          bounce: { type: 'number' },
        },
        required: ['date', 'sent', 'replied', 'positiveReply', 'bounce'],
      },
      CampaignStatsTotals: {
        type: 'object',
        properties: {
          sentCount: { type: 'number' },
          repliedCount: { type: 'number' },
          positiveReplyCount: { type: 'number' },
          bounceCount: { type: 'number' },
          lastBounceAt: { type: 'string', format: 'date-time', nullable: true },
          enrollmentCount: { type: 'integer' },
          terminalEnrollmentCount: { type: 'integer' },
          contactedEnrollmentCount: { type: 'integer' },
        },
        required: [
          'sentCount',
          'repliedCount',
          'positiveReplyCount',
          'bounceCount',
          'lastBounceAt',
          'enrollmentCount',
          'terminalEnrollmentCount',
          'contactedEnrollmentCount',
        ],
      },
      CampaignStats: {
        type: 'object',
        properties: {
          daily: {
            type: 'array',
            items: schemaRef('CampaignStatsDaily'),
          },
          totals: schemaRef('CampaignStatsTotals'),
        },
        required: ['daily', 'totals'],
      },
      CampaignListResponse: {
        type: 'object',
        properties: {
          data: { type: 'array', items: schemaRef('Campaign') },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
          total_count: { type: 'integer' },
        },
        required: ['data', 'limit', 'offset', 'total_count'],
      },
      CampaignResponse: {
        type: 'object',
        properties: {
          data: schemaRef('Campaign'),
        },
        required: ['data'],
      },
      CampaignFlowResponse: {
        type: 'object',
        properties: {
          data: schemaRef('CampaignFlow'),
        },
        required: ['data'],
      },
      CampaignStatusResponse: {
        type: 'object',
        properties: {
          data: schemaRef('CampaignStatusResult'),
        },
        required: ['data'],
      },
      PauseEnrollmentsRequest: {
        type: 'object',
        properties: {
          global_lead_ids: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
          },
        },
        required: ['global_lead_ids'],
      },
      ResumeEnrollmentsRequest: {
        type: 'object',
        properties: {
          global_lead_ids: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
          },
        },
        required: ['global_lead_ids'],
      },
      EnrollmentActionResult: {
        type: 'object',
        properties: {
          paused: { type: 'integer' },
          resumed: { type: 'integer' },
          skipped: { type: 'integer' },
          errors: { type: 'array', items: { type: 'object' } },
        },
      },
      EnrollmentActionResponse: {
        type: 'object',
        properties: {
          data: schemaRef('EnrollmentActionResult'),
        },
        required: ['data'],
      },
      LeadFieldsResponse: {
        type: 'object',
        properties: {
          data: schemaRef('LeadFields'),
        },
        required: ['data'],
      },
      LeadFieldResponse: {
        type: 'object',
        properties: {
          data: schemaRef('LeadFieldResult'),
        },
        required: ['data'],
      },
      LeadListResponse: {
        type: 'object',
        properties: {
          data: { type: 'array', items: schemaRef('Lead') },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
          total_count: { type: 'integer' },
        },
        required: ['data', 'limit', 'offset', 'total_count'],
      },
      LeadResponse: {
        type: 'object',
        properties: {
          data: schemaRef('Lead'),
        },
        required: ['data'],
      },
      DeleteResponse: {
        type: 'object',
        properties: {
          data: schemaRef('DeleteResult'),
        },
        required: ['data'],
      },
      ImportJobResponse: {
        type: 'object',
        properties: {
          data: schemaRef('ImportJob'),
        },
        required: ['data'],
      },
      MailboxListResponse: {
        type: 'object',
        properties: {
          data: { type: 'array', items: schemaRef('Mailbox') },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
          total_count: { type: 'integer' },
        },
        required: ['data', 'limit', 'offset', 'total_count'],
      },
      MailboxResponse: {
        type: 'object',
        properties: {
          data: schemaRef('Mailbox'),
        },
        required: ['data'],
      },
      ThreadListResponse: {
        type: 'object',
        properties: {
          data: { type: 'array', items: schemaRef('Thread') },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
          total_count: { type: 'integer' },
        },
        required: ['data', 'limit', 'offset', 'total_count'],
      },
      ThreadResponse: {
        type: 'object',
        properties: {
          data: schemaRef('Thread'),
        },
        required: ['data'],
      },
      MessageListResponse: {
        type: 'object',
        properties: {
          data: { type: 'array', items: schemaRef('Message') },
        },
        required: ['data'],
      },
      GlobalLeadIdsRequest: {
        type: 'object',
        properties: {
          global_lead_ids: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: BULK_SYNC_LIMIT,
          },
        },
        required: ['global_lead_ids'],
        additionalProperties: false,
      },
      BulkMembershipActionResult: {
        type: 'object',
        additionalProperties: true,
        description: 'RPC result counts from sync membership operations.',
      },
      BulkMembershipActionResponse: {
        type: 'object',
        properties: {
          data: schemaRef('BulkMembershipActionResult'),
        },
        required: ['data'],
      },
      Person: {
        type: 'object',
        description: 'Account-scoped person rollup row from the people explorer.',
        additionalProperties: true,
      },
      PersonUpdate: {
        type: 'object',
        properties: {
          name: { type: 'string', nullable: true },
          first_name: { type: 'string', nullable: true },
          last_name: { type: 'string', nullable: true },
          company_name: { type: 'string', nullable: true },
        },
        additionalProperties: false,
      },
      PersonResponse: {
        type: 'object',
        properties: {
          data: schemaRef('Person'),
        },
        required: ['data'],
      },
      PersonDetailResponse: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              person: schemaRef('Person'),
              memberships: {
                type: 'array',
                items: { type: 'object', additionalProperties: true },
              },
            },
            required: ['person', 'memberships'],
          },
        },
        required: ['data'],
      },
      PersonListResponse: {
        type: 'object',
        properties: {
          data: { type: 'array', items: schemaRef('Person') },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
          total_count: { type: 'integer' },
        },
        required: ['data', 'limit', 'offset', 'total_count'],
      },
      LeadSavedList: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          account_id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
          column_layout: { type: 'array', items: { type: 'object', additionalProperties: true } },
          created_at: { type: 'string', format: 'date-time', nullable: true },
          updated_at: { type: 'string', format: 'date-time', nullable: true },
        },
        required: ['id', 'name'],
        additionalProperties: true,
      },
      LeadSavedListCreate: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
          global_lead_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['name'],
        additionalProperties: false,
      },
      LeadSavedListUpdate: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
          column_layout: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
        additionalProperties: false,
      },
      LeadSavedListResponse: {
        type: 'object',
        properties: {
          data: schemaRef('LeadSavedList'),
        },
        required: ['data'],
      },
      LeadSavedListArrayResponse: {
        type: 'object',
        properties: {
          data: { type: 'array', items: schemaRef('LeadSavedList') },
        },
        required: ['data'],
      },
      LeadListMembersResult: {
        type: 'object',
        properties: {
          added: { type: 'integer' },
          removed: { type: 'integer' },
          skippedAlreadyMember: { type: 'integer' },
          skippedNotMember: { type: 'integer' },
        },
        additionalProperties: true,
      },
      LeadListMembersResultResponse: {
        type: 'object',
        properties: {
          data: schemaRef('LeadListMembersResult'),
        },
        required: ['data'],
      },
      BatchCompletionWebhookPayload: {
        type: 'object',
        description: 'Standard payload for async or sync bulk completion webhooks.',
        properties: {
          job_id: { type: 'string', format: 'uuid', nullable: true },
          source: { type: 'string', enum: ['async', 'sync'] },
          campaign_id: { type: 'string', format: 'uuid', nullable: true },
          operation: { type: 'string', enum: [...IMPORT_JOB_OPERATIONS] },
          counts: {
            type: 'object',
            additionalProperties: { type: 'integer' },
          },
          errors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                global_lead_id: { type: 'string' },
                index: { type: 'integer' },
                message: { type: 'string' },
              },
              required: ['message'],
            },
          },
          global_lead_ids: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['job_id', 'source', 'campaign_id', 'operation', 'counts', 'errors'],
      },
      ReplyJobResponse: {
        type: 'object',
        properties: {
          data: schemaRef('ReplyJobResult'),
        },
        required: ['data'],
      },
      MessageJobResponse: {
        type: 'object',
        properties: {
          data: schemaRef('MessageJob'),
        },
        required: ['data'],
      },
      ThreadTagListResponse: {
        type: 'object',
        properties: {
          data: { type: 'array', items: schemaRef('ThreadTag') },
        },
        required: ['data'],
      },
      ThreadTagAssignmentResponse: {
        type: 'object',
        properties: {
          data: schemaRef('ThreadTagAssignmentResult'),
        },
        required: ['data'],
      },
      ReplaceLeadResponse: {
        type: 'object',
        properties: {
          data: schemaRef('ReplaceLeadResult'),
        },
        required: ['data'],
      },
      BlockListListResponse: {
        type: 'object',
        properties: {
          data: { type: 'array', items: schemaRef('BlockListEntry') },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
          total_count: { type: 'integer' },
        },
        required: ['data', 'limit', 'offset', 'total_count'],
      },
      BlockListResponse: {
        type: 'object',
        properties: {
          data: schemaRef('BlockListEntry'),
        },
        required: ['data'],
      },
      CampaignStatsResponse: {
        type: 'object',
        properties: {
          data: schemaRef('CampaignStats'),
        },
        required: ['data'],
      },
      OpenApiDocument: {
        type: 'object',
        description: 'The live OpenAPI document returned by `/openapi.json`.',
        additionalProperties: true,
      },
      DocsHtml: {
        type: 'string',
        description: 'Scalar HTML application.',
      },
      LimitsGuide: {
        type: 'object',
        properties: {
          default_page_size: { type: 'integer', example: DEFAULT_PAGE_SIZE },
          max_page_size: { type: 'integer', example: MAX_PAGE_SIZE },
          bulk_sync_limit: { type: 'integer', example: BULK_SYNC_LIMIT },
          bulk_async_limit: { type: 'integer', example: BULK_ASYNC_LIMIT },
          max_async_jobs_per_account: { type: 'integer', example: MAX_ASYNC_JOBS_PER_ACCOUNT },
        },
      },
    },
  };
}
