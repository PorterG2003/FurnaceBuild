import {
  API_KEY_PREFIX,
  BULK_ASYNC_LIMIT,
  BULK_SYNC_LIMIT,
  DEFAULT_PAGE_SIZE,
  IMPORT_JOB_OPERATIONS,
  MAX_ASYNC_JOBS_PER_ACCOUNT,
  MAX_PAGE_SIZE,
  MAX_QUEUED_ASYNC_JOBS_PER_ACCOUNT,
  RATE_LIMIT_REQUESTS_PER_MINUTE,
  STAGED_IMPORT_APPEND_LIMIT,
} from './constants.js';
import { API_BULK_SCOPE_KINDS } from '../bulk/scope.js';
import {
  CAMPAIGN_FLOW_EXAMPLE_CATEGORIZER,
  CAMPAIGN_FLOW_EXAMPLE_DATASENDER,
  CAMPAIGN_FLOW_EXAMPLE_LINEAR,
} from '../../campaigns/flow/index.js';
import {
  buildCampaignFlowDescription,
  buildEmailNodeDataDescription,
  buildEmailVariantDescription,
  buildFlowUpdateDescription,
  buildFlowValidateResultDescription,
  buildFlowValidationIssueDescription,
  buildLeadSourceNodeDataDescription,
  buildWaitTimeNodeDataDescription,
} from './flowSchemaDescriptions.js';
import { modelLink } from './docLinks.js';

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
      FlowNodeId: {
        name: 'nodeId',
        in: 'path',
        required: true,
        description: 'Flow node id.',
        schema: { type: 'string' },
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
      ApiKeyId: {
        name: 'id',
        in: 'path',
        required: true,
        description: 'API key id.',
        schema: { type: 'string', format: 'uuid' },
      },
      MailboxConnectSessionId: {
        name: 'id',
        in: 'path',
        required: true,
        description: 'Mailbox connect session id.',
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
        description:
          'Case-insensitive prefix search across thread subject, participants, lead name/email/company, campaign name, thread tags, and message bodies (min 2 characters).',
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
        description: 'Inclusive ISO-8601 timestamp filter on `last_inbound_at` (latest lead reply).',
        schema: { type: 'string', format: 'date-time' },
      },
      DateTo: {
        name: 'date_to',
        in: 'query',
        description: 'Inclusive ISO-8601 timestamp filter on `last_inbound_at` (latest lead reply).',
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
        description:
          'Optional idempotency key for campaign create, lead create, and bulk lead imports. Retries with the same key and body return the cached response.',
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
      ConflictError: {
        description: 'The request conflicts with the current resource state.',
        headers: rateLimitHeaders(),
        content: {
          'application/json': {
            schema: schemaRef('Error'),
            example: {
              error: {
                type: 'invalid_request_error',
                code: 'target_missing_enrollment',
                message:
                  'The existing contact for this address has no active enrollment in this campaign; launch the campaign or re-add the contact before replacing. Call GET /v1/threads/{id}/replace-lead/preview to inspect the match first.',
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
                code: 'invalid_flow',
                message: 'Flow validation failed',
              },
              details: [
                {
                  path: 'nodes[1].data.variants[0].id',
                  code: 'invalid_variant_id',
                  message: 'Email variants must have a stable UUID id.',
                },
              ],
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
      ApiError: {
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
          details: {
            type: 'array',
            items: schemaRef('FlowValidationIssue'),
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
          schedule: {
            allOf: [schemaRef('CampaignSchedule')],
            nullable: true,
            description: 'Send window. `null` means send 24/7.',
          },
          sending_interval_seconds: { type: 'number', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time', nullable: true },
          deleted_at: { type: 'string', format: 'date-time', nullable: true },
          tags: {
            type: 'array',
            items: schemaRef('CampaignTag'),
            description: 'Campaign tags assigned to this campaign.',
          },
          mailbox_ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            description: 'Mailbox ids currently attached to this campaign.',
          },
        },
        required: ['id', 'status', 'created_at'],
        additionalProperties: false,
      },
      CampaignFlow: {
        type: 'object',
        description: buildCampaignFlowDescription('openapi'),
        properties: {
          nodes: {
            type: 'array',
            items: schemaRef('FlowNode'),
          },
          edges: {
            type: 'array',
            items: schemaRef('FlowEdge'),
          },
        },
        required: ['nodes', 'edges'],
        additionalProperties: false,
        example: CAMPAIGN_FLOW_EXAMPLE_LINEAR,
        examples: {
          linear: {
            summary: 'Email → wait → email',
            value: CAMPAIGN_FLOW_EXAMPLE_LINEAR,
          },
          categorizer: {
            summary: 'Categorizer branch',
            value: CAMPAIGN_FLOW_EXAMPLE_CATEGORIZER,
          },
          dataSender: {
            summary: 'Data sender webhook',
            value: CAMPAIGN_FLOW_EXAMPLE_DATASENDER,
          },
        },
      },
      FlowPosition: {
        type: 'object',
        description: 'Builder canvas coordinates. Cosmetic; safe to change on live campaigns.',
        properties: {
          x: { type: 'number', description: 'Horizontal position in the flow editor.', example: 220 },
          y: { type: 'number', description: 'Vertical position in the flow editor.', example: 0 },
        },
        required: ['x', 'y'],
        additionalProperties: false,
      },
      EmailVariant: {
        type: 'object',
        description: buildEmailVariantDescription('openapi'),
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Stable variant UUID. Generate once before first save.',
            example: '11111111-1111-4111-8111-111111111111',
          },
          label: { type: 'string', description: 'Display label (A, B, …). Re-derived on save.', example: 'A' },
          subject: {
            type: 'string',
            description: 'Email subject. Supports merge variables like {{first_name}}.',
            example: 'Quick question for {{first_name}}',
          },
          template: {
            type: 'string',
            description: 'Primary email body (plain or rich text). Supports merge variables.',
            example: 'Hi {{first_name}} - reaching out about {{custom.company}}.',
          },
          body_html: {
            type: 'string',
            nullable: true,
            description: 'HTML body when editor_mode is html.',
          },
          body_text: {
            type: 'string',
            nullable: true,
            description: 'Plain-text fallback body.',
          },
          editor_mode: {
            type: 'string',
            enum: ['richText', 'html'],
            nullable: true,
            description: 'Editor mode. Canonicalized on save.',
            example: 'richText',
          },
          isActive: {
            type: 'boolean',
            description: 'When false, variant is skipped in round-robin. At least one variant per email node must be active.',
            example: true,
          },
          order: {
            type: 'integer',
            description: 'Round-robin sort order. Re-derived on save.',
            example: 0,
          },
        },
        required: ['id', 'label', 'subject', 'template', 'isActive', 'order'],
        additionalProperties: false,
      },
      FlowNode: {
        type: 'object',
        description:
          `One node in the campaign flow graph. The data shape depends on type — see ${modelLink('LeadSourceNodeData', 'openapi')}, ${modelLink('EmailNodeData', 'openapi')}, ${modelLink('WaitTimeNodeData', 'openapi')}, ${modelLink('AICategorizerNodeData', 'openapi')}, and ${modelLink('DataSenderNodeData', 'openapi')}.`,
        properties: {
          id: {
            type: 'string',
            description: 'Stable flow node id referenced by edges and runtime node sync. Keep stable across edits.',
            example: 'email-1',
          },
          type: {
            type: 'string',
            enum: ['leadSource', 'email', 'waitTime', 'aiCategorizer', 'dataSender'],
            description: 'Node kind. Exactly one leadSource per flow; at most one aiCategorizer.',
            example: 'email',
          },
          position: schemaRef('FlowPosition'),
          data: {
            description: 'Type-specific node configuration.',
            oneOf: [
              schemaRef('LeadSourceNodeData'),
              schemaRef('EmailNodeData'),
              schemaRef('WaitTimeNodeData'),
              schemaRef('AICategorizerNodeData'),
              schemaRef('DataSenderNodeData'),
            ],
          },
          deletable: {
            type: 'boolean',
            nullable: true,
            description: 'When false, node cannot be deleted in the builder. Lead source is always non-deletable.',
            example: true,
          },
        },
        required: ['id', 'type', 'position', 'data'],
        additionalProperties: false,
      },
      FlowEdge: {
        type: 'object',
        description:
          'Directed connection between two nodes. Categorizer outgoing edges must set sourceHandle to interested, neutral, or not-interested.',
        properties: {
          id: { type: 'string', description: 'Stable edge identifier.', example: 'e1' },
          source: { type: 'string', description: 'Source node id.', example: 'leadSource-1' },
          target: { type: 'string', description: 'Target node id.', example: 'email-1' },
          sourceHandle: {
            type: 'string',
            nullable: true,
            description: 'Required on aiCategorizer branch edges: interested, neutral, or not-interested.',
            example: 'interested',
          },
          targetHandle: {
            type: 'string',
            nullable: true,
            description: 'Reserved for future use.',
          },
          type: {
            type: 'string',
            nullable: true,
            description: 'Builder edge type. Stripped on save when set to deletable.',
          },
        },
        required: ['id', 'source', 'target'],
        additionalProperties: false,
      },
      LeadSourceNodeData: {
        type: 'object',
        description: buildLeadSourceNodeDataDescription('openapi'),
        properties: {
          label: { type: 'string', description: 'Display label.', example: 'Lead Bucket' },
          source: { type: 'string', nullable: true, description: 'Legacy source label.' },
          bucketId: { type: 'string', nullable: true, description: 'Optional lead bucket reference.' },
          customFieldKeys: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Custom personalization keys. Enables {{custom.<key>}} merge tokens and requires matching keys in lead custom_lead_data on import.',
            example: ['company', 'title'],
          },
          mappedStandardFieldKeys: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Standard lead fields available as merge variables. When omitted, all standard fields are allowed.',
            example: ['email', 'first_name', 'last_name'],
          },
          isRequired: {
            type: 'boolean',
            nullable: true,
            description: 'When true, leads missing required custom fields count as incomplete on import.',
            example: true,
          },
        },
        additionalProperties: false,
      },
      EmailNodeData: {
        type: 'object',
        description: buildEmailNodeDataDescription('openapi'),
        properties: {
          label: { type: 'string', description: 'Display label.', example: 'Intro Email' },
          mailboxId: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'Sending mailbox. Falls back to campaign mailbox rotation when unset.',
          },
          priority: {
            type: 'boolean',
            nullable: true,
            description:
              'Derived priority marker (not user-set). True when the email is downstream of a categorizer and sends on the immediate/priority lane.',
            example: false,
          },
          variants: {
            type: 'array',
            items: schemaRef('EmailVariant'),
            description: '1–20 variants. At least one must be active.',
            minItems: 1,
            maxItems: 20,
          },
        },
        required: ['variants'],
        additionalProperties: false,
      },
      WaitTimeNodeData: {
        type: 'object',
        description: buildWaitTimeNodeDataDescription(),
        properties: {
          label: { type: 'string', description: 'Display label.', example: 'Wait 3 days' },
          duration: {
            type: 'string',
            nullable: true,
            description: 'Display duration value. Furnace derives this from wait_duration_seconds on save.',
            example: '3',
          },
          unit: {
            type: 'string',
            enum: ['minutes', 'hours', 'days'],
            nullable: true,
            description: 'Display unit. Furnace derives this from wait_duration_seconds on save.',
            example: 'days',
          },
          wait_duration_seconds: {
            type: 'integer',
            description:
              'Delay in seconds (runtime source of truth). Minimum 180 (3 minutes). Empty/missing values normalize to 259200 (3 days).',
            example: 259200,
            minimum: 180,
          },
        },
        required: ['wait_duration_seconds'],
        additionalProperties: false,
      },
      AICategorizerNodeData: {
        type: 'object',
        description:
          'Reply classifier node. At most one per flow. Outgoing edges must use sourceHandle interested, neutral, or not-interested.',
        properties: {
          label: { type: 'string', description: 'Display label.', example: 'Categorizer' },
          use_ai: {
            type: 'boolean',
            description: 'When true, uses AI to classify replies.',
            example: true,
          },
        },
        additionalProperties: false,
      },
      DataSenderNodeData: {
        type: 'object',
        description: `Webhook node that POSTs lead data to an external URL when a lead reaches this step. Supports merge variables in \`payload\`. See ${modelLink('CampaignFlow', 'openapi')} examples for a full dataSender flow.`,
        properties: {
          label: { type: 'string', description: 'Display label.', example: 'Notify CRM' },
          endpoint: {
            type: 'string',
            nullable: true,
            description: 'Alias for endpoint_url.',
          },
          endpoint_url: {
            type: 'string',
            format: 'uri',
            nullable: true,
            description: 'HTTPS webhook URL.',
            example: 'https://hooks.example.com/lead-contacted',
          },
          payload: {
            type: 'string',
            nullable: true,
            description: 'JSON string body. Supports merge variables.',
            example: '{"email":"{{email}}","company":"{{custom.company}}"}',
          },
          payload_template: {
            type: 'object',
            additionalProperties: true,
            description: 'Object form of payload. Serialized to payload on save when payload string is empty.',
          },
          on_failure: {
            type: 'string',
            enum: ['continue', 'stop'],
            nullable: true,
            description: 'Whether enrollment continues after a failed POST.',
            example: 'continue',
          },
        },
        additionalProperties: false,
      },
      CampaignSchedule: {
        type: 'object',
        description:
          'Campaign send window. Set the parent `schedule` field to `null` for 24/7 sending. On create, omitting `schedule` applies the product default (Central 9–5 Mon–Fri) rather than 24/7. `days_of_week` uses JS `Date.getDay()` (0=Sun … 6=Sat); null/empty means every day.',
        properties: {
          timezone: {
            type: 'string',
            description: 'IANA timezone, e.g. `America/Chicago`.',
            example: 'America/Chicago',
          },
          start_hour: {
            type: 'integer',
            minimum: 0,
            maximum: 23,
            description: 'Inclusive start hour in the campaign timezone.',
            example: 9,
          },
          end_hour: {
            type: 'integer',
            minimum: 0,
            maximum: 23,
            description: 'Exclusive end hour in the campaign timezone.',
            example: 17,
          },
          days_of_week: {
            type: 'array',
            items: { type: 'integer', minimum: 0, maximum: 6 },
            nullable: true,
            description: 'Allowed weekdays. Null/empty = every day.',
            example: [1, 2, 3, 4, 5],
          },
          start_minute: {
            type: 'integer',
            minimum: 0,
            maximum: 59,
            description: 'Optional start minute. Defaults to 0 when omitted.',
            example: 0,
          },
          end_minute: {
            type: 'integer',
            minimum: 0,
            maximum: 59,
            description: 'Optional end minute. Defaults to 0 when omitted.',
            example: 0,
          },
        },
        required: ['timezone', 'start_hour', 'end_hour'],
        additionalProperties: false,
      },
      CampaignCreate: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          schedule: {
            allOf: [schemaRef('CampaignSchedule')],
            nullable: true,
            description:
              'Send window. Omit to use Central 9–5 Mon–Fri. Pass `null` for 24/7.',
          },
          sending_interval_seconds: {
            type: 'number',
            description:
              'Seconds between sends per mailbox. Omit to use `1440` (24 minutes; ~20 emails per mailbox per day on the default window).',
          },
          mailbox_ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
          },
          tag_ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
          },
          flow: schemaRef('CampaignFlow'),
        },
        additionalProperties: false,
      },
      FlowUpdate: {
        description: buildFlowUpdateDescription('openapi'),
        allOf: [schemaRef('CampaignFlow')],
        example: CAMPAIGN_FLOW_EXAMPLE_CATEGORIZER,
      },
      FlowValidationIssue: {
        type: 'object',
        description: buildFlowValidationIssueDescription('openapi'),
        properties: {
          path: { type: 'string' },
          code: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['path', 'code', 'message'],
        additionalProperties: false,
      },
      FlowValidateResult: {
        type: 'object',
        description: buildFlowValidateResultDescription('openapi'),
        properties: {
          normalized_flow: schemaRef('CampaignFlow'),
          allowed: {
            type: 'boolean',
            description: 'Whether the campaign status permits this change (false when structural edit on live campaign).',
            example: true,
          },
          change_kind: {
            type: 'string',
            enum: ['none', 'content', 'structural'],
            description: 'Classification of the diff against the stored flow.',
            example: 'content',
          },
          change_reasons: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Machine-readable change reasons: node_added, node_removed, node_type_changed, edge_added_or_rewired, edge_removed_or_rewired, variant_removed_or_replaced, content_changed.',
            example: ['content_changed'],
          },
          lifecycle: {
            type: 'object',
            description: 'Lifecycle gate result. When blocked, code is flow_locked.',
            properties: {
              allowed: { type: 'boolean', example: true },
              code: { type: 'string', nullable: true, example: 'flow_locked' },
              message: { type: 'string', nullable: true },
            },
            required: ['allowed'],
            additionalProperties: false,
          },
          issues: {
            type: 'array',
            items: schemaRef('FlowValidationIssue'),
            description: 'Validation problems. Empty when the flow is valid.',
          },
        },
        required: ['normalized_flow', 'allowed', 'change_kind', 'change_reasons', 'lifecycle', 'issues'],
        additionalProperties: false,
      },
      LaunchResponse: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['running'] },
          enrolled: { type: 'integer', description: 'Number of leads enrolled at launch.' },
        },
        required: ['id', 'status'],
        additionalProperties: false,
      },
      CampaignStatusUpdate: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['running', 'paused', 'stopped'] },
        },
        required: ['status'],
        additionalProperties: false,
      },
      FieldSync: {
        type: 'object',
        properties: {
          declared_custom_added: { type: 'array', items: { type: 'string' } },
          declared_standard_added: { type: 'array', items: { type: 'string' } },
        },
        required: ['declared_custom_added', 'declared_standard_added'],
        additionalProperties: false,
      },
      FlowSaveResult: {
        type: 'object',
        properties: {
          flow: schemaRef('CampaignFlow'),
          flow_revision: { type: 'string', description: 'SHA-256 of canonical normalized flow.' },
          field_sync: schemaRef('FieldSync'),
          change_kind: { type: 'string', enum: ['none', 'content', 'structural'] },
          change_reasons: { type: 'array', items: { type: 'string' } },
          reactivated_count: {
            type: 'integer',
            description: 'Completed enrollments reactivated on non-categorizer nodes with a live outgoing edge after a flow save.',
          },
        },
        required: ['flow', 'flow_revision', 'field_sync', 'reactivated_count'],
        additionalProperties: false,
      },
      FlowNodePatch: {
        type: 'object',
        properties: {
          data: { type: 'object', additionalProperties: true },
        },
        required: ['data'],
        additionalProperties: false,
      },
      CampaignUpdate: {
        type: 'object',
        description: 'Mutable campaign fields. Mailbox ids can replace the full set or be incrementally added and removed.',
        properties: {
          name: { type: 'string' },
          schedule: {
            allOf: [schemaRef('CampaignSchedule')],
            nullable: true,
            description: 'Send window. `null` means send 24/7.',
          },
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
          phone_number: { type: 'string', nullable: true },
          mobile_phone_number: { type: 'string', nullable: true },
          custom_lead_data: { type: 'object', additionalProperties: true },
          source: { type: 'string', examples: ['api'] },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time', nullable: true },
          deleted_at: { type: 'string', format: 'date-time', nullable: true },
        },
        required: ['id', 'campaign_id', 'email', 'created_at'],
        additionalProperties: false,
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
          phone_number: { type: 'string' },
          mobile_phone_number: { type: 'string' },
          custom_lead_data: {
            type: 'object',
            additionalProperties: true,
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional person-level tags. Pass catalog names or aliases (for example `Hunter`, `Hunter.io`, `Running Meta Ads`) or any custom name. Matching is case-insensitive. Unknown names create an account-owned tag. Tags attach to the person (`global_lead_id`), not the campaign lead row, so they persist across campaigns. Do not put MillionVerifier statuses here — use `email_verification`. Catch-All Domain and Role Account are operator filters and are not auto-applied from verification.',
          },
          email_verification: {
            type: 'object',
            additionalProperties: false,
            description:
              'Optional structured email verification from a vendor such as MillionVerifier. Send this when you already paid for a check; omit it otherwise. Status values: `ok`, `catch_all`, `invalid`, `unknown`, `disposable`. Stored on `lead_email_facts`, not as tags, and survives rollup refresh. Do not invent a status.',
            properties: {
              status: {
                type: 'string',
                enum: ['ok', 'catch_all', 'invalid', 'unknown', 'disposable'],
              },
              quality: { type: 'string' },
              provider: { type: 'string' },
              verified_at: { type: 'string', format: 'date-time' },
              is_free: { type: 'boolean' },
              is_role: { type: 'boolean' },
            },
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
          phone_number: { type: 'string', nullable: true },
          mobile_phone_number: { type: 'string', nullable: true },
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
      ImportJobError: {
        type: 'object',
        description: 'Per-item error recorded on an async import/membership job.',
        properties: {
          globalLeadId: {
            type: 'string',
            nullable: true,
            description: 'Person id when the failure is scoped to a global lead (camelCase as emitted by RPCs).',
          },
          index: {
            type: 'integer',
            description: 'Optional array index for lead-import errors.',
          },
          message: { type: 'string' },
        },
        required: ['message'],
        additionalProperties: false,
      },
      ImportJobResult: {
        type: 'object',
        description:
          'Aggregated counts written when a job completes. Which fields are populated depends on `input.operation` (e.g. import/add use created/updated/enrolled; remove uses removed; pause/resume use paused/resumed).',
        properties: {
          created: { type: 'integer' },
          updated: { type: 'integer' },
          enrolled: { type: 'integer' },
          skipped: { type: 'integer' },
          incomplete: { type: 'integer' },
          failed: { type: 'integer' },
          paused: { type: 'integer' },
          resumed: { type: 'integer' },
          removed: { type: 'integer' },
          added: { type: 'integer' },
          rows_exported: { type: 'integer' },
          imported: {
            type: 'integer',
            description: 'Convenience total (`created + updated`) set on lead-import completion.',
          },
          errors: {
            type: 'array',
            items: schemaRef('ImportJobError'),
          },
        },
        additionalProperties: false,
      },
      ImportJobInput: {
        type: 'object',
        description:
          'Stored job payload. Uses `saved_list_id` when scoped to a list (the create request field is `list_id`). Includes `operation` plus scope fields (`global_lead_ids`, `saved_list_id`, `source_campaign_id`, `leads`, `exclusions`, etc.).',
        properties: {
          operation: { type: 'string', enum: [...IMPORT_JOB_OPERATIONS] },
          global_lead_ids: { type: 'array', items: { type: 'string' } },
          saved_list_id: { type: 'string', format: 'uuid' },
          source_campaign_id: { type: 'string', format: 'uuid' },
          target_list_id: { type: 'string', format: 'uuid' },
          upload_id: { type: 'string', format: 'uuid' },
          list_id: { type: 'string', format: 'uuid' },
          leads: {
            type: 'array',
            items: schemaRef('LeadCreate'),
          },
          total_count: { type: 'integer' },
          source: { type: 'string' },
          exclusions: schemaRef('BulkExclusions'),
          preview_id: { type: 'string' },
          expected_count: { type: 'integer' },
          projection: { type: 'string', enum: ['full', 'compact'] },
          query: { type: 'object', additionalProperties: true },
          column_layout: { type: 'array', items: { type: 'object', additionalProperties: true } },
          filename_base: { type: 'string' },
        },
        required: ['operation'],
        additionalProperties: true,
      },
      ImportJob: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          account_id: { type: 'string', format: 'uuid' },
          campaign_id: { type: 'string', format: 'uuid', nullable: true },
          created_by_api_key_id: { type: 'string', format: 'uuid', nullable: true },
          status: {
            type: 'string',
            enum: ['uploading', 'queued', 'running', 'completed', 'failed', 'cancelled'],
          },
          progress: { type: 'integer', minimum: 0, maximum: 100 },
          cursor: { type: 'integer', minimum: 0 },
          input: schemaRef('ImportJobInput'),
          result: schemaRef('ImportJobResult'),
          errors: {
            type: 'array',
            items: schemaRef('ImportJobError'),
          },
          cancel_requested_at: { type: 'string', format: 'date-time', nullable: true },
          started_at: { type: 'string', format: 'date-time', nullable: true },
          completed_at: { type: 'string', format: 'date-time', nullable: true },
          created_at: { type: 'string', format: 'date-time', nullable: true },
          updated_at: { type: 'string', format: 'date-time', nullable: true },
        },
        required: ['id', 'status', 'input', 'result', 'errors'],
        additionalProperties: false,
      },
      ImportJobCreate: {
        type: 'object',
        description:
          'Create one logical async bulk job. Prefer `scope` (+ optional `exclusions`) over inline ID batches. Poll `GET /v1/jobs/{id}`; cancel with `POST /v1/jobs/{id}/cancel`.',
        properties: {
          operation: { type: 'string', enum: [...IMPORT_JOB_OPERATIONS] },
          campaign_id: { type: 'string', format: 'uuid', nullable: true },
          global_lead_ids: { type: 'array', items: { type: 'string' } },
          list_id: { type: 'string', format: 'uuid' },
          target_list_id: { type: 'string', format: 'uuid' },
          source_campaign_id: { type: 'string', format: 'uuid' },
          upload_id: { type: 'string', format: 'uuid' },
          scope: schemaRef('BulkScope'),
          exclusions: schemaRef('BulkExclusions'),
          preview_id: { type: 'string' },
          expected_count: { type: 'integer' },
          projection: { type: 'string', enum: ['full', 'compact'] },
          filename_base: { type: 'string' },
          column_layout: { type: 'array', items: { type: 'object', additionalProperties: true } },
          leads: {
            type: 'array',
            maxItems: BULK_ASYNC_LIMIT,
            items: schemaRef('LeadCreate'),
          },
        },
        required: ['operation'],
        additionalProperties: false,
      },
      BulkScope: {
        type: 'object',
        description: 'Server-side population selector. Prefer list/campaign/staged scopes for bulk work.',
        properties: {
          kind: { type: 'string', enum: [...API_BULK_SCOPE_KINDS] },
          global_lead_ids: { type: 'array', items: { type: 'string' } },
          list_id: { type: 'string', format: 'uuid' },
          campaign_id: { type: 'string', format: 'uuid' },
          upload_id: { type: 'string', format: 'uuid' },
          query: { type: 'object', additionalProperties: true },
        },
        required: ['kind'],
        additionalProperties: false,
      },
      BulkExclusions: {
        type: 'object',
        description: 'People to exclude from a scoped bulk mutation.',
        properties: {
          list_id: { type: 'string', format: 'uuid' },
          campaign_id: { type: 'string', format: 'uuid' },
          global_lead_ids: { type: 'array', items: { type: 'string' } },
          emails: { type: 'array', items: { type: 'string', format: 'email' } },
        },
        additionalProperties: false,
      },
      BulkPreviewRequest: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: [...IMPORT_JOB_OPERATIONS] },
          campaign_id: { type: 'string', format: 'uuid', nullable: true },
          target_list_id: { type: 'string', format: 'uuid' },
          list_id: { type: 'string', format: 'uuid' },
          global_lead_ids: { type: 'array', items: { type: 'string' } },
          scope: schemaRef('BulkScope'),
          exclusions: schemaRef('BulkExclusions'),
        },
        required: ['operation'],
        additionalProperties: false,
      },
      BulkPreviewResponse: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              preview_id: { type: 'string' },
              operation: { type: 'string' },
              operation_hash: { type: 'string' },
              expires_at: { type: 'string', format: 'date-time' },
              counts: {
                type: 'object',
                properties: {
                  matched: { type: 'integer' },
                  excluded: { type: 'integer' },
                  duplicate: { type: 'integer' },
                  ineligible: { type: 'integer' },
                  actionable: { type: 'integer' },
                },
                required: ['matched', 'excluded', 'duplicate', 'ineligible', 'actionable'],
              },
              warnings: { type: 'array', items: { type: 'string' } },
              scope: schemaRef('BulkScope'),
              exclusions: { allOf: [schemaRef('BulkExclusions')], nullable: true },
              target: { type: 'object', additionalProperties: true },
            },
            required: ['preview_id', 'operation', 'operation_hash', 'expires_at', 'counts', 'warnings', 'scope'],
          },
        },
        required: ['data'],
      },
      StagedImportCreateResponse: {
        type: 'object',
        properties: {
          data: schemaRef('ImportJob'),
        },
        required: ['data'],
      },
      StagedImportAppendRequest: {
        type: 'object',
        properties: {
          leads: {
            type: 'array',
            minItems: 1,
            maxItems: STAGED_IMPORT_APPEND_LIMIT,
            items: schemaRef('LeadCreate'),
          },
        },
        required: ['leads'],
        additionalProperties: false,
      },
      StagedImportAppendResponse: {
        type: 'object',
        properties: {
          uploaded_count: { type: 'integer' },
          total_count: { type: 'integer' },
        },
        required: ['uploaded_count', 'total_count'],
      },
      BulkUploadCreateRequest: {
        type: 'object',
        properties: {
          campaign_id: { type: 'string', format: 'uuid' },
          filename: { type: 'string' },
          content_type: { type: 'string' },
        },
        required: ['campaign_id'],
        additionalProperties: false,
      },
      BulkUploadCreateResponse: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              upload_id: { type: 'string', format: 'uuid' },
              upload_url: { type: 'string', format: 'uri' },
              expires_at: { type: 'string', format: 'date-time' },
              filename: { type: 'string' },
              content_type: { type: 'string' },
            },
            required: ['upload_id', 'upload_url', 'expires_at'],
          },
        },
        required: ['data'],
      },
      LimitsGuideResponse: {
        type: 'object',
        properties: {
          data: schemaRef('LimitsGuide'),
        },
        required: ['data'],
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
        additionalProperties: false,
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
          last_message_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Latest activity in either direction (sent or received).',
          },
          last_inbound_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Latest inbound lead reply. Used for inbox Newest/Oldest sort and date filters.',
          },
        },
        required: ['id', 'account_id'],
        additionalProperties: false,
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
          to_name: { type: 'string', nullable: true },
          to_emails: {
            type: 'array',
            items: { type: 'string', format: 'email' },
            nullable: true,
            description:
              'All To addresses when known. to_email remains the primary/first recipient.',
          },
          cc: {
            type: 'array',
            items: { type: 'string', format: 'email' },
            nullable: true,
          },
          received_at: { type: 'string', format: 'date-time', nullable: true },
        },
        required: ['id', 'thread_id'],
        additionalProperties: false,
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
          new_mobile_phone_number: { type: 'string', nullable: true },
          reason: {
            type: 'string',
            nullable: true,
            enum: ['auto_reply_forward', 'manual_referral', 'wrong_contact', 'role_change', 'other'],
            description: 'Defaults to manual_referral when omitted.',
          },
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
          mode: {
            type: 'string',
            enum: ['created', 'attached'],
            description:
              'created = a new lead was inserted and the original archived. attached = the address was already a live lead in this campaign, so that contact was reused, the conversation was moved to them, and the original lead was retired as stopped/replaced. new_lead_id is the pre-existing contact in that case.',
          },
          target_lead_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description:
              'On mode = attached, the pre-existing campaign contact that was reused. Null on mode = created.',
          },
          retired_sibling_count: {
            type: 'integer',
            description:
              'Only non-zero on mode = attached. How many duplicate lead rows for the same address had their sequence stopped.',
          },
          forward_job_id: { type: 'string', format: 'uuid', nullable: true },
        },
        required: ['replacement_id', 'new_lead_id'],
      },
      ReplaceLeadPreviewLead: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', nullable: true },
          name: { type: 'string', nullable: true },
          first_name: { type: 'string', nullable: true },
          last_name: { type: 'string', nullable: true },
          phone_number: { type: 'string', nullable: true },
          mobile_phone_number: { type: 'string', nullable: true },
          company_name: { type: 'string', nullable: true },
          website: { type: 'string', nullable: true },
          linkedin_url: { type: 'string', nullable: true },
          company_linkedin_url: { type: 'string', nullable: true },
          custom_lead_data: { type: 'object', additionalProperties: true },
          enrollment_id: { type: 'string', format: 'uuid', nullable: true },
          enrollment_state: {
            type: 'string',
            nullable: true,
            enum: ['active', 'paused', 'completed', 'stopped'],
          },
          has_been_contacted: { type: 'boolean' },
          last_activity_at: { type: 'string', format: 'date-time', nullable: true },
        },
        required: ['id', 'has_been_contacted', 'custom_lead_data'],
        additionalProperties: false,
      },
      ReplaceLeadPreview: {
        type: 'object',
        properties: {
          email: { type: 'string', nullable: true },
          mode: {
            type: 'string',
            enum: ['created', 'attached'],
            description:
              'What POST /v1/threads/{id}/replace-lead would do: created when no live campaign match, attached when an existing contact would be reused.',
          },
          allowed: {
            type: 'boolean',
            description:
              'False when the write path would refuse this email. See disallowed_reason.',
          },
          disallowed_reason: {
            type: 'string',
            nullable: true,
            enum: ['same_as_current_lead', 'target_missing_enrollment'],
            description:
              'Same error codes the write path returns: same_as_current_lead (400) or target_missing_enrollment (409). Null when allowed.',
          },
          match_count: {
            type: 'integer',
            description: 'How many live campaign lead rows match this address (excluding the current thread lead).',
          },
          matches_current_lead: { type: 'boolean' },
          blocked: {
            type: 'boolean',
            description:
              'True when the address or its domain is on the account block list. Does not by itself block replace; it is a warning for the caller.',
          },
          block_reason: { type: 'string', nullable: true },
          existing_lead: {
            allOf: [schemaRef('ReplaceLeadPreviewLead')],
            nullable: true,
          },
        },
        required: [
          'mode',
          'allowed',
          'match_count',
          'matches_current_lead',
          'blocked',
          'existing_lead',
        ],
        additionalProperties: false,
      },
      ReplaceLeadPreviewResponse: {
        type: 'object',
        properties: {
          data: schemaRef('ReplaceLeadPreview'),
        },
        required: ['data'],
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
        additionalProperties: false,
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
        additionalProperties: false,
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
      CampaignCreateResponse: {
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
      FlowSaveResponse: {
        type: 'object',
        properties: {
          data: schemaRef('FlowSaveResult'),
        },
        required: ['data'],
      },
      FlowRevisionConflictError: {
        type: 'object',
        properties: {
          error: schemaRef('ApiError'),
          current_flow_revision: { type: 'string' },
        },
        required: ['error', 'current_flow_revision'],
      },
      FlowTemplatesResponse: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                description: { type: 'string' },
                flow: schemaRef('CampaignFlow'),
              },
              required: ['id', 'name', 'description', 'flow'],
            },
          },
        },
        required: ['data'],
      },
      FlowValidateResponse: {
        type: 'object',
        properties: {
          data: schemaRef('FlowValidateResult'),
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
      LaunchResponseEnvelope: {
        type: 'object',
        properties: {
          data: schemaRef('LaunchResponse'),
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
      MembershipActionError: {
        type: 'object',
        description: 'Per-item error from a sync membership RPC.',
        properties: {
          globalLeadId: {
            type: 'string',
            nullable: true,
            description: 'Person id when the failure is scoped to a global lead (camelCase as emitted by RPCs).',
          },
          message: { type: 'string', nullable: true },
        },
        additionalProperties: false,
      },
      MembershipAddResult: {
        type: 'object',
        description: 'Counts from `add_global_leads_to_campaign`.',
        properties: {
          created: { type: 'integer' },
          updated: { type: 'integer' },
          enrolled: { type: 'integer' },
          skipped: { type: 'integer' },
          incomplete: { type: 'integer' },
          failed: { type: 'integer' },
          errors: {
            type: 'array',
            items: schemaRef('MembershipActionError'),
          },
        },
        required: ['created', 'updated', 'enrolled', 'skipped', 'incomplete', 'failed', 'errors'],
        additionalProperties: false,
      },
      MembershipRemoveResult: {
        type: 'object',
        description: 'Counts from remove-membership RPCs.',
        properties: {
          removed: { type: 'integer' },
          skipped: { type: 'integer' },
          errors: {
            type: 'array',
            items: schemaRef('MembershipActionError'),
          },
        },
        required: ['removed', 'skipped', 'errors'],
        additionalProperties: false,
      },
      MembershipAddResponse: {
        type: 'object',
        properties: {
          data: schemaRef('MembershipAddResult'),
        },
        required: ['data'],
      },
      MembershipRemoveResponse: {
        type: 'object',
        properties: {
          data: schemaRef('MembershipRemoveResult'),
        },
        required: ['data'],
      },
      Person: {
        type: 'object',
        description:
          'Account-scoped person rollup. List and detail share one shape (`latest_activity_at`). Detail/PATCH responses may also include `account_id`, rollup counts, and `updated_at`.',
        properties: {
          global_lead_id: { type: 'string' },
          email: { type: 'string', nullable: true },
          display_name: { type: 'string', nullable: true },
          first_name: { type: 'string', nullable: true },
          last_name: { type: 'string', nullable: true },
          campaign_count: { type: 'integer' },
          company_list: { type: 'string', nullable: true },
          has_reply: { type: 'boolean' },
          latest_activity_at: { type: 'string', format: 'date-time', nullable: true },
          newest_membership_created_at: { type: 'string', format: 'date-time', nullable: true },
          account_id: { type: 'string', format: 'uuid' },
          native_campaign_count: { type: 'integer' },
          smartlead_campaign_count: { type: 'integer' },
          updated_at: { type: 'string', format: 'date-time' },
        },
        required: ['global_lead_id', 'campaign_count', 'has_reply'],
        additionalProperties: false,
      },
      PersonMembership: {
        type: 'object',
        description:
          'Minimal campaign membership slice for a person (`leads` row). `deleted_at` null means the membership is active.',
        properties: {
          id: { type: 'string', format: 'uuid' },
          campaign_id: { type: 'string', format: 'uuid' },
          email: { type: 'string', nullable: true },
          deleted_at: { type: 'string', format: 'date-time', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'campaign_id', 'created_at'],
        additionalProperties: false,
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
                items: schemaRef('PersonMembership'),
              },
            },
            required: ['person', 'memberships'],
            additionalProperties: false,
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
        additionalProperties: false,
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
        additionalProperties: false,
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
      WebhookSettings: {
        type: 'object',
        properties: {
          webhook_url: { type: 'string', nullable: true },
          webhook_signing_secret: { type: 'string', nullable: true },
          webhook_enabled_events: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
      WebhookSettingsUpdate: {
        type: 'object',
        properties: {
          webhook_url: { type: 'string', nullable: true },
          webhook_signing_secret: { type: 'string', nullable: true },
          webhook_enabled_events: {
            type: 'array',
            items: { type: 'string' },
            nullable: true,
          },
        },
        additionalProperties: false,
      },
      WebhookSettingsResponse: {
        type: 'object',
        properties: {
          data: schemaRef('WebhookSettings'),
        },
        required: ['data'],
      },
      ApiKey: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          account_id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          secret_prefix: { type: 'string' },
          expires_at: { type: 'string', format: 'date-time', nullable: true },
          last_used_at: { type: 'string', format: 'date-time', nullable: true },
          revoked_at: { type: 'string', format: 'date-time', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
        additionalProperties: false,
      },
      ApiKeyCreate: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          expires_at: { type: 'string', format: 'date-time', nullable: true },
        },
        additionalProperties: false,
      },
      ApiKeyWithSecret: {
        allOf: [
          schemaRef('ApiKey'),
          {
            type: 'object',
            properties: {
              secret: {
                type: 'string',
                description: 'Full API key secret. Returned only on create.',
              },
            },
            required: ['secret'],
          },
        ],
      },
      ApiKeyListResponse: {
        type: 'object',
        properties: {
          data: { type: 'array', items: schemaRef('ApiKey') },
        },
        required: ['data'],
      },
      ApiKeyResponse: {
        type: 'object',
        properties: {
          data: schemaRef('ApiKey'),
        },
        required: ['data'],
      },
      ApiKeyCreatedResponse: {
        type: 'object',
        properties: {
          data: schemaRef('ApiKeyWithSecret'),
        },
        required: ['data'],
      },
      MailboxConnectSession: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          status: {
            type: 'string',
            enum: ['pending', 'completed', 'expired', 'failed'],
          },
          expires_at: { type: 'string', format: 'date-time' },
          mailbox_id: { type: 'string', format: 'uuid', nullable: true },
          connect_url: { type: 'string', format: 'uri' },
          error_message: { type: 'string', nullable: true },
        },
        additionalProperties: false,
      },
      MailboxConnectSessionResponse: {
        type: 'object',
        properties: {
          data: schemaRef('MailboxConnectSession'),
        },
        required: ['data'],
      },
      OpenApiDocument: {
        type: 'object',
        description: 'The live OpenAPI document returned by `/openapi.json`.',
        additionalProperties: true,
      },
      LimitsGuide: {
        type: 'object',
        properties: {
          default_page_size: { type: 'integer', example: DEFAULT_PAGE_SIZE },
          max_page_size: { type: 'integer', example: MAX_PAGE_SIZE },
          bulk_sync_limit: { type: 'integer', example: BULK_SYNC_LIMIT },
          bulk_async_limit: { type: 'integer', example: BULK_ASYNC_LIMIT },
          max_async_jobs_per_account: {
            type: 'integer',
            example: MAX_ASYNC_JOBS_PER_ACCOUNT,
            description: 'Max concurrent running jobs per account (worker claim slots).',
          },
          max_queued_async_jobs_per_account: {
            type: 'integer',
            example: MAX_QUEUED_ASYNC_JOBS_PER_ACCOUNT,
            description: 'Max jobs allowed in queued status while waiting for a running slot.',
          },
          staged_import_append_limit: { type: 'integer', example: STAGED_IMPORT_APPEND_LIMIT },
          supported_scope_kinds: {
            type: 'array',
            items: { type: 'string', enum: [...API_BULK_SCOPE_KINDS] },
          },
          supported_job_operations: {
            type: 'array',
            items: { type: 'string', enum: [...IMPORT_JOB_OPERATIONS] },
          },
          file_ingress: {
            type: 'object',
            properties: {
              staged_json_batches: { type: 'boolean' },
              presigned_object_upload: { type: 'boolean' },
              local_path_not_supported: { type: 'boolean' },
            },
          },
        },
      },
    },
  };
}
