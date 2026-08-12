import {
  BULK_ASYNC_LIMIT,
  BULK_SYNC_LIMIT,
  IMPORT_JOB_OPERATIONS,
  MAX_ASYNC_JOBS_PER_ACCOUNT,
} from './constants.js';
import { modelLink } from './docLinks.js';
import { parameterRef, responseRef, schemaRef } from './schemas.js';

function rateLimitHeaders() {
  return {
    'X-RateLimit-Limit': { $ref: '#/components/headers/XRateLimitLimit' },
    'X-RateLimit-Remaining': { $ref: '#/components/headers/XRateLimitRemaining' },
    'X-RateLimit-Reset': { $ref: '#/components/headers/XRateLimitReset' },
  };
}

function jsonResponse(schemaName: string, description: string, example?: unknown) {
  return {
    description,
    headers: rateLimitHeaders(),
    content: {
      'application/json': {
        schema: schemaRef(schemaName),
        ...(example === undefined ? {} : { example }),
      },
    },
  };
}

function authenticatedErrors(...extraNames: string[]) {
  return {
    401: responseRef('UnauthorizedError'),
    ...Object.fromEntries(extraNames.map((name) => [
      name === 'ValidationError'
        ? 400
        : name === 'ForbiddenError'
          ? 403
          : name === 'NotFoundError'
            ? 404
            : name === 'ConflictError'
              ? 409
              : 500,
      responseRef(name),
    ])),
    429: responseRef('RateLimitError'),
    500: responseRef('InternalError'),
  };
}

function jsonRequestBody(schemaName: string, example?: unknown) {
  return {
    required: true,
    content: {
      'application/json': {
        schema: schemaRef(schemaName),
        ...(example === undefined ? {} : { example }),
      },
    },
  };
}

export function buildClientApiPaths() {
  return {
    '/health': {
      get: {
        operationId: 'getHealth',
        tags: ['Meta'],
        summary: 'Health check',
        description: 'Checks that the API runtime is alive and can reach the backing database.',
        security: [],
        responses: {
          200: {
            description: 'API and database are healthy.',
            content: {
              'application/json': {
                schema: schemaRef('HealthResponse'),
                example: { status: 'ok', db: 'ok' },
              },
            },
          },
          503: {
            description: 'API is reachable but the database health check failed.',
            content: {
              'application/json': {
                schema: schemaRef('HealthResponse'),
                example: { status: 'error', db: 'error' },
              },
            },
          },
        },
      },
    },
    '/openapi.json': {
      get: {
        operationId: 'getOpenApiDocument',
        tags: ['Meta'],
        summary: 'OpenAPI document',
        description: 'Returns the live OpenAPI contract served by Furnace.',
        security: [],
        responses: {
          200: {
            description: 'OpenAPI document.',
            content: {
              'application/json': {
                schema: schemaRef('OpenApiDocument'),
              },
            },
          },
        },
      },
    },
    '/v1/meta/limits': {
      get: {
        operationId: 'getLimits',
        tags: ['Meta'],
        summary: 'API limits and bulk capabilities',
        description:
          'Returns page sizes, sync/async bulk caps, queued vs running job quotas, supported scopes/operations, and file-ingress capabilities. Agents should configure chunking from this document rather than hard-coding limits.',
        responses: {
          200: jsonResponse('LimitsGuideResponse', 'Limits and capabilities.'),
          ...authenticatedErrors(),
        },
      },
    },
    '/v1/bulk/preview': {
      post: {
        operationId: 'previewBulkOperation',
        tags: ['Jobs'],
        summary: 'Preview a bulk operation',
        description:
          'Estimates matched/excluded/actionable counts for a scoped bulk mutation. Pass the returned `preview_id` when creating the job to bind execution to the preview.',
        requestBody: jsonRequestBody('BulkPreviewRequest', {
          operation: 'add_to_campaign',
          campaign_id: '1d8dc901-3d2d-4d9f-9dcc-4f8b3aa1a1fb',
          scope: { kind: 'saved_list', list_id: '7c0d0f5a-2f61-4a2a-9f1d-1b2c3d4e5f60' },
          exclusions: { list_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
        }),
        responses: {
          200: jsonResponse('BulkPreviewResponse', 'Bulk preview.'),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
    },
    '/v1/campaigns/{id}/imports/staged': {
      post: {
        operationId: 'createStagedLeadImport',
        tags: ['Leads'],
        summary: 'Create staged lead import',
        description:
          'Creates an uploading import job. Append lead batches with `appendStagedLeadImportRows`, then finalize with `finalizeStagedLeadImport`. Prefer this over inline async import for multi-thousand-lead files. Local filesystem paths are not accepted.',
        parameters: [parameterRef('CampaignId')],
        responses: {
          201: jsonResponse('StagedImportCreateResponse', 'Staged import job created.'),
          ...authenticatedErrors('ValidationError', 'ForbiddenError', 'NotFoundError'),
        },
      },
    },
    '/v1/jobs/{id}/staging-rows': {
      post: {
        operationId: 'appendStagedLeadImportRows',
        tags: ['Leads'],
        summary: 'Append staged import rows',
        description:
          'Appends up to 500 lead objects to a staged import job in `uploading` status.',
        parameters: [parameterRef('JobId')],
        requestBody: jsonRequestBody('StagedImportAppendRequest'),
        responses: {
          200: jsonResponse('StagedImportAppendResponse', 'Rows appended.'),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
    },
    '/v1/jobs/{id}/finalize': {
      post: {
        operationId: 'finalizeStagedLeadImport',
        tags: ['Leads'],
        summary: 'Finalize staged lead import',
        description:
          'Marks a staged import job queued and enqueues worker processing. Idempotent if already queued/running/completed.',
        parameters: [parameterRef('JobId')],
        responses: {
          202: jsonResponse('ImportJobResponse', 'Staged import finalized.'),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
    },
    '/v1/uploads/presign': {
      post: {
        operationId: 'createBulkUploadUrl',
        tags: ['Leads'],
        summary: 'Create presigned bulk upload URL',
        description:
          'Optional file ingress for MCP hosts that can PUT directly to S3. Returns `upload_id` + temporary `upload_url`. Generic MCP clients that cannot perform arbitrary HTTP uploads should use staged JSON append instead. Local paths are never accepted by the server.',
        requestBody: jsonRequestBody('BulkUploadCreateRequest'),
        responses: {
          201: jsonResponse('BulkUploadCreateResponse', 'Presigned upload created.'),
          ...authenticatedErrors('ValidationError'),
        },
      },
    },
    '/v1/people/export': {
      post: {
        operationId: 'exportPeople',
        tags: ['People'],
        summary: 'Export people (async)',
        description:
          'Starts one logical export job for a server-side scope. Use `projection: compact` for email/global_lead_id dumps. Poll `GET /v1/jobs/{id}` for `result.download_url`.',
        requestBody: jsonRequestBody('ImportJobCreate', {
          operation: 'export_leads',
          scope: { kind: 'saved_list', list_id: '7c0d0f5a-2f61-4a2a-9f1d-1b2c3d4e5f60' },
          projection: 'compact',
        }),
        responses: {
          202: jsonResponse('ImportJobResponse', 'Export job queued.'),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
    },
    '/v1/campaigns/{id}/enroll': {
      post: {
        operationId: 'enrollPeople',
        tags: ['Leads'],
        summary: 'Enroll people into campaign (async)',
        description:
          'Starts one logical enroll job from a server-side scope (saved list, campaign, selection) with optional exclusions. Prefer this over sync add for large sets.',
        parameters: [parameterRef('CampaignId')],
        requestBody: jsonRequestBody('ImportJobCreate', {
          operation: 'add_to_campaign',
          scope: { kind: 'saved_list', list_id: '7c0d0f5a-2f61-4a2a-9f1d-1b2c3d4e5f60' },
          exclusions: { list_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
        }),
        responses: {
          202: jsonResponse('ImportJobResponse', 'Enroll job queued.'),
          ...authenticatedErrors('ValidationError', 'ForbiddenError', 'NotFoundError'),
        },
      },
    },
    '/v1/lead-lists/{id}/members:bulk': {
      post: {
        operationId: 'updateLeadListMembership',
        tags: ['Lead Lists'],
        summary: 'Bulk update lead list membership (async)',
        description:
          'Starts one logical add/remove membership job. Body.operation must be `add_to_lead_list` or `remove_from_lead_list`. Source may be scope (list/campaign/selection) with optional exclusions on add.',
        parameters: [parameterRef('LeadListId')],
        requestBody: jsonRequestBody('ImportJobCreate', {
          operation: 'add_to_lead_list',
          scope: { kind: 'campaign', campaign_id: '1d8dc901-3d2d-4d9f-9dcc-4f8b3aa1a1fb' },
        }),
        responses: {
          202: jsonResponse('ImportJobResponse', 'Membership job queued.'),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
    },
    '/v1/campaigns': {
      get: {
        operationId: 'listCampaigns',
        tags: ['Campaigns'],
        summary: 'List campaigns',
        description: 'Lists campaigns in the authenticated account. Results are paginated and can optionally include soft-deleted campaigns.',
        parameters: [
          parameterRef('Limit'),
          parameterRef('Offset'),
          parameterRef('Search'),
          parameterRef('CampaignStatus'),
          parameterRef('CampaignTagIds'),
          parameterRef('IncludeDeletedCampaigns'),
        ],
        responses: {
          200: jsonResponse('CampaignListResponse', 'Campaign page.', {
            data: [
              {
                id: '1d8dc901-3d2d-4d9f-9dcc-4f8b3aa1a1fb',
                name: 'Q2 Pipeline',
                status: 'running',
                source: 'manual',
                created_at: '2026-05-21T18:00:00.000Z',
              },
            ],
            limit: 20,
            offset: 0,
            total_count: 1,
          }),
          ...authenticatedErrors(),
        },
      },
      post: {
        operationId: 'createCampaign',
        tags: ['Campaigns'],
        summary: 'Create draft campaign',
        description:
          `Creates a draft native campaign. Optional \`flow\` is normalized and validated on write. Supports idempotent retries with \`Idempotency-Key\`. See ${modelLink('CampaignFlow', 'openapi')} and [Campaign setup](/docs/guides/campaign-setup/).`,
        parameters: [parameterRef('IdempotencyKey')],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: schemaRef('CampaignCreate'),
              example: {
                name: 'Q2 Pipeline',
                sending_interval_seconds: 1440,
                mailbox_ids: ['c23da7b6-df4e-4d2f-b100-4bb07b7d38d7'],
                flow: {
                  nodes: [
                    {
                      id: 'leadSource-1',
                      type: 'leadSource',
                      position: { x: 0, y: 0 },
                      data: {
                        label: 'Lead Bucket',
                        customFieldKeys: ['company'],
                      },
                    },
                  ],
                  edges: [],
                },
              },
            },
          },
        },
        responses: {
          201: jsonResponse('CampaignCreateResponse', 'Draft campaign created.'),
          ...authenticatedErrors('ValidationError'),
        },
      },
    },
    '/v1/campaigns/{id}': {
      get: {
        operationId: 'getCampaign',
        tags: ['Campaigns'],
        summary: 'Get campaign',
        description: 'Returns one campaign within the API key account scope.',
        parameters: [parameterRef('CampaignId')],
        responses: {
          200: jsonResponse('CampaignResponse', 'Campaign response.'),
          ...authenticatedErrors('NotFoundError'),
        },
      },
      patch: {
        operationId: 'updateCampaign',
        tags: ['Campaigns'],
        summary: 'Update campaign',
        description: 'Updates mutable campaign fields. Mailboxes can be replaced wholesale with `mailbox_ids`, or incrementally edited with `add_mailbox_ids` and `remove_mailbox_ids`. Tags can be replaced with `tag_ids`, or incrementally edited with `add_tag_ids` and `remove_tag_ids`.',
        parameters: [parameterRef('CampaignId')],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: schemaRef('CampaignUpdate'),
              example: {
                name: 'Q2 Pipeline Refresh',
                sending_interval_seconds: 1800,
                add_mailbox_ids: ['c23da7b6-df4e-4d2f-b100-4bb07b7d38d7'],
              },
            },
          },
        },
        responses: {
          200: jsonResponse('CampaignResponse', 'Updated campaign.'),
          ...authenticatedErrors('ValidationError', 'ForbiddenError', 'NotFoundError'),
        },
      },
      delete: {
        operationId: 'deleteCampaign',
        tags: ['Campaigns'],
        summary: 'Delete campaign',
        description: 'Soft-deletes the campaign, stops enrollments, and tombstones campaign nodes. Smartlead campaigns remain read-only.',
        parameters: [parameterRef('CampaignId')],
        responses: {
          200: jsonResponse('DeleteResponse', 'Campaign deleted.', {
            data: { id: '1d8dc901-3d2d-4d9f-9dcc-4f8b3aa1a1fb', deleted: true },
          }),
          ...authenticatedErrors('ForbiddenError', 'NotFoundError'),
        },
      },
    },
    '/v1/campaign-tags': {
      get: {
        operationId: 'listCampaignTags',
        tags: ['Campaigns'],
        summary: 'List campaign tags',
        description: 'Lists account-scoped campaign tag definitions.',
        responses: {
          200: jsonResponse('CampaignTagListResponse', 'Campaign tag list.'),
          ...authenticatedErrors(),
        },
      },
      post: {
        operationId: 'createCampaignTag',
        tags: ['Campaigns'],
        summary: 'Create campaign tag',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: schemaRef('CampaignTagCreate'),
              example: { name: 'Enterprise', color: '#818CF8' },
            },
          },
        },
        responses: {
          201: jsonResponse('CampaignTagResponse', 'Created campaign tag.'),
          ...authenticatedErrors('ValidationError'),
        },
      },
    },
    '/v1/campaign-tags/{id}': {
      patch: {
        operationId: 'updateCampaignTag',
        tags: ['Campaigns'],
        summary: 'Update campaign tag',
        parameters: [parameterRef('CampaignTagId')],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: schemaRef('CampaignTagUpdate'),
            },
          },
        },
        responses: {
          200: jsonResponse('CampaignTagResponse', 'Updated campaign tag.'),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
      delete: {
        operationId: 'deleteCampaignTag',
        tags: ['Campaigns'],
        summary: 'Delete campaign tag',
        parameters: [parameterRef('CampaignTagId')],
        responses: {
          200: jsonResponse('DeleteResponse', 'Campaign tag deleted.'),
          ...authenticatedErrors('NotFoundError'),
        },
      },
    },
    '/v1/mailbox-tags': {
      get: {
        operationId: 'listMailboxTags',
        tags: ['Mailboxes'],
        summary: 'List mailbox tags',
        description: 'Lists account-scoped mailbox tag definitions.',
        responses: {
          200: jsonResponse('MailboxTagListResponse', 'Mailbox tag list.'),
          ...authenticatedErrors(),
        },
      },
      post: {
        operationId: 'createMailboxTag',
        tags: ['Mailboxes'],
        summary: 'Create mailbox tag',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: schemaRef('MailboxTagCreate'),
              example: { name: 'Warm-up pool', color: '#22C55E' },
            },
          },
        },
        responses: {
          201: jsonResponse('MailboxTagResponse', 'Created mailbox tag.'),
          ...authenticatedErrors('ValidationError'),
        },
      },
    },
    '/v1/mailbox-tags/{id}': {
      patch: {
        operationId: 'updateMailboxTag',
        tags: ['Mailboxes'],
        summary: 'Update mailbox tag',
        parameters: [parameterRef('MailboxTagId')],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: schemaRef('MailboxTagUpdate'),
            },
          },
        },
        responses: {
          200: jsonResponse('MailboxTagResponse', 'Updated mailbox tag.'),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
      delete: {
        operationId: 'deleteMailboxTag',
        tags: ['Mailboxes'],
        summary: 'Delete mailbox tag',
        parameters: [parameterRef('MailboxTagId')],
        responses: {
          200: jsonResponse('DeleteResponse', 'Mailbox tag deleted.'),
          ...authenticatedErrors('NotFoundError'),
        },
      },
    },
    '/v1/campaigns/{id}/status': {
      patch: {
        operationId: 'updateCampaignStatus',
        tags: ['Campaigns'],
        summary: 'Update live campaign status',
        description:
          'Changes status for a live campaign (`running`, `paused`, or `stopped`). Draft campaigns must use `POST /launch` instead. Emits campaign status webhooks.',
        parameters: [parameterRef('CampaignId')],
        requestBody: jsonRequestBody('CampaignStatusUpdate'),
        responses: {
          200: jsonResponse('CampaignStatusResponse', 'Campaign status updated.'),
          ...authenticatedErrors('ValidationError', 'ForbiddenError', 'NotFoundError'),
        },
      },
    },
    '/v1/flow-templates': {
      get: {
        operationId: 'listFlowTemplates',
        tags: ['Flow'],
        summary: 'List flow templates',
        description: 'Returns starter flow graphs for common campaign patterns.',
        responses: {
          200: jsonResponse('FlowTemplatesResponse', 'Flow templates.'),
          ...authenticatedErrors(),
        },
      },
    },
    '/v1/campaigns/{id}/pause': {
      post: {
        operationId: 'pauseCampaign',
        tags: ['Campaigns'],
        summary: 'Pause campaign (deprecated)',
        deprecated: true,
        description: 'Deprecated alias for `PATCH /v1/campaigns/{id}/status` with `{ "status": "paused" }`.',
        parameters: [parameterRef('CampaignId')],
        responses: {
          200: jsonResponse('CampaignStatusResponse', 'Campaign paused.', {
            data: { id: '1d8dc901-3d2d-4d9f-9dcc-4f8b3aa1a1fb', status: 'paused' },
          }),
          ...authenticatedErrors('ForbiddenError', 'NotFoundError'),
        },
      },
    },
    '/v1/campaigns/{id}/stop': {
      post: {
        operationId: 'stopCampaign',
        tags: ['Campaigns'],
        summary: 'Stop campaign (deprecated)',
        deprecated: true,
        description: 'Deprecated alias for `PATCH /v1/campaigns/{id}/status` with `{ "status": "stopped" }`.',
        parameters: [parameterRef('CampaignId')],
        responses: {
          200: jsonResponse('CampaignStatusResponse', 'Campaign stopped.', {
            data: { id: '1d8dc901-3d2d-4d9f-9dcc-4f8b3aa1a1fb', status: 'stopped' },
          }),
          ...authenticatedErrors('ForbiddenError', 'NotFoundError'),
        },
      },
    },
    '/v1/campaigns/{id}/resume': {
      post: {
        operationId: 'resumeCampaign',
        tags: ['Campaigns'],
        summary: 'Resume campaign (deprecated)',
        deprecated: true,
        description: 'Deprecated alias for `PATCH /v1/campaigns/{id}/status` with `{ "status": "running" }`.',
        parameters: [parameterRef('CampaignId')],
        responses: {
          200: jsonResponse('CampaignStatusResponse', 'Campaign resumed.', {
            data: { id: '1d8dc901-3d2d-4d9f-9dcc-4f8b3aa1a1fb', status: 'running' },
          }),
          ...authenticatedErrors('ValidationError', 'ForbiddenError', 'NotFoundError'),
        },
      },
    },
    '/v1/campaigns/{id}/launch': {
      post: {
        operationId: 'launchCampaign',
        tags: ['Campaigns'],
        summary: 'Launch draft campaign',
        description:
          'Launches a draft campaign after verifying that it has a name, flow, and at least one mailbox. Furnace backfills enrollments before switching the campaign to `running`.',
        parameters: [parameterRef('CampaignId')],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', additionalProperties: false },
              example: {},
            },
          },
        },
        responses: {
          200: jsonResponse('LaunchResponseEnvelope', 'Campaign launched.', {
            data: { id: '1d8dc901-3d2d-4d9f-9dcc-4f8b3aa1a1fb', status: 'running' },
          }),
          ...authenticatedErrors('ValidationError', 'ForbiddenError', 'NotFoundError'),
        },
      },
    },
    '/v1/campaigns/{id}/enrollments/pause': {
      post: {
        operationId: 'pauseCampaignEnrollments',
        tags: ['Campaigns'],
        summary: 'Pause enrollments',
        description:
          'Manually pauses enrollments for the given global lead IDs in a native campaign and emits one `enrollment.pause_completed` batch webhook.',
        parameters: [parameterRef('CampaignId')],
        requestBody: jsonRequestBody('PauseEnrollmentsRequest'),
        responses: {
          200: jsonResponse('EnrollmentActionResponse', 'Enrollments paused.', {
            data: { paused: 2, skipped: 0, errors: [] },
          }),
          ...authenticatedErrors('ValidationError', 'ForbiddenError', 'NotFoundError'),
        },
      },
    },
    '/v1/campaigns/{id}/enrollments/resume': {
      post: {
        operationId: 'resumeCampaignEnrollments',
        tags: ['Campaigns'],
        summary: 'Resume enrollments',
        description:
          'Resumes manually paused enrollments for the given global lead IDs. Requires campaign status `running`. Emits one `enrollment.resume_completed` batch webhook.',
        parameters: [parameterRef('CampaignId')],
        requestBody: jsonRequestBody('ResumeEnrollmentsRequest'),
        responses: {
          200: jsonResponse('EnrollmentActionResponse', 'Enrollments resumed.', {
            data: { resumed: 2, skipped: 0, errors: [] },
          }),
          ...authenticatedErrors('ValidationError', 'ForbiddenError', 'NotFoundError'),
        },
      },
    },
    '/v1/campaigns/{id}/flow': {
      get: {
        operationId: 'getCampaignFlow',
        tags: ['Flow'],
        summary: 'Get campaign flow',
        description:
          `Returns the normalized campaign flow graph. If a campaign has no saved flow, Furnace returns an empty \`{ nodes: [], edges: [] }\` payload. See ${modelLink('CampaignFlow', 'openapi')} and [Campaign setup](/docs/guides/campaign-setup/).`,
        parameters: [parameterRef('CampaignId')],
        responses: {
          200: jsonResponse('CampaignFlowResponse', 'Campaign flow.'),
          ...authenticatedErrors('NotFoundError'),
        },
      },
      put: {
        operationId: 'updateCampaignFlow',
        tags: ['Flow'],
        summary: 'Update campaign flow (deprecated alias)',
        deprecated: true,
        description:
          'Deprecated alias of `POST /v1/campaigns/{id}/flow`. Prefer POST with optional `If-Match`.',
        parameters: [parameterRef('CampaignId')],
        requestBody: jsonRequestBody('FlowUpdate'),
        responses: {
          200: jsonResponse('FlowSaveResponse', 'Updated normalized flow.'),
          ...authenticatedErrors('ValidationError', 'ForbiddenError', 'NotFoundError'),
        },
      },
      post: {
        operationId: 'saveCampaignFlow',
        tags: ['Flow'],
        summary: 'Save campaign flow',
        description:
          `Writes the canonical flow payload. Returns \`flow\`, \`flow_revision\`, and \`field_sync\`. Use \`?dry_run=true\` to validate without persisting. Optional \`If-Match\` header for optimistic concurrency. Request body: ${modelLink('FlowUpdate', 'openapi')}.`,
        parameters: [
          parameterRef('CampaignId'),
          {
            name: 'dry_run',
            in: 'query',
            required: false,
            schema: { type: 'boolean' },
            description: 'When true, validate without persisting.',
          },
        ],
        requestBody: jsonRequestBody('FlowUpdate'),
        responses: {
          200: jsonResponse('FlowSaveResponse', 'Saved normalized flow.'),
          412: jsonResponse('FlowRevisionConflictError', 'Stale If-Match revision.'),
          ...authenticatedErrors('ValidationError', 'ForbiddenError', 'NotFoundError'),
        },
      },
    },
    '/v1/campaigns/{id}/flow/nodes/{nodeId}': {
      patch: {
        operationId: 'patchCampaignFlowNode',
        tags: ['Flow'],
        summary: 'Patch flow node content',
        description: 'Live content-only patch for supported node types (email, waitTime, dataSender).',
        parameters: [parameterRef('CampaignId'), parameterRef('FlowNodeId')],
        requestBody: jsonRequestBody('FlowNodePatch'),
        responses: {
          200: jsonResponse('FlowSaveResponse', 'Updated node content.'),
          ...authenticatedErrors('ValidationError', 'ForbiddenError', 'NotFoundError'),
        },
      },
    },
    '/v1/campaigns/{id}/flow:validate': {
      post: {
        operationId: 'validateCampaignFlow',
        tags: ['Flow'],
        summary: 'Validate campaign flow',
        description:
          `Dry-runs flow normalization, validation, and lifecycle gating without writing changes. See ${modelLink('FlowValidateResult', 'openapi')} and [Campaign setup](/docs/guides/campaign-setup/).`,
        parameters: [parameterRef('CampaignId')],
        requestBody: jsonRequestBody('FlowUpdate'),
        responses: {
          200: jsonResponse('FlowValidateResponse', 'Flow validation result.'),
          ...authenticatedErrors('ForbiddenError', 'NotFoundError'),
        },
      },
    },
    '/v1/campaigns/{id}/lead-fields': {
      get: {
        operationId: 'getCampaignLeadFields',
        tags: ['Lead fields'],
        summary: 'Get lead fields',
        description: 'Returns the mapped standard lead fields and required custom lead field keys extracted from lead source nodes in the campaign flow.',
        parameters: [parameterRef('CampaignId')],
        responses: {
          200: jsonResponse('LeadFieldsResponse', 'Lead field definitions.', {
            data: {
              standard: ['email', 'first_name', 'last_name'],
              custom: ['company', 'source'],
            },
          }),
          ...authenticatedErrors('NotFoundError'),
        },
      },
      post: {
        operationId: 'appendCampaignLeadField',
        tags: ['Lead fields'],
        summary: 'Append lead field',
        description: 'Appends a custom lead field key to the campaign flow and preserves existing keys.',
        parameters: [parameterRef('CampaignId')],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: schemaRef('LeadFieldCreate'),
              example: { key: 'source' },
            },
          },
        },
        responses: {
          200: jsonResponse('LeadFieldResponse', 'Lead field appended.', {
            data: { key: 'source' },
          }),
          ...authenticatedErrors('ValidationError', 'ForbiddenError', 'NotFoundError'),
        },
      },
    },
    '/v1/campaigns/{id}/leads': {
      get: {
        operationId: 'listCampaignLeads',
        tags: ['Leads'],
        summary: 'List campaign leads',
        description: 'Lists non-deleted leads for a campaign. Search matches email and name fields.',
        parameters: [
          parameterRef('CampaignId'),
          parameterRef('Limit'),
          parameterRef('Offset'),
          parameterRef('Search'),
        ],
        responses: {
          200: jsonResponse('LeadListResponse', 'Lead page.'),
          ...authenticatedErrors('NotFoundError'),
        },
      },
      post: {
        operationId: 'createOrUpsertLead',
        tags: ['Leads'],
        summary: 'Create or upsert lead',
        description: 'Creates a lead or updates the existing non-deleted lead with the same campaign/email pair. This endpoint supports idempotent retries via `Idempotency-Key` and emits `lead.created` or `lead.updated` outbound webhook events.',
        parameters: [parameterRef('CampaignId'), parameterRef('IdempotencyKey')],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: schemaRef('LeadCreate'),
              example: {
                email: 'jane@example.com',
                name: 'Jane Doe',
                first_name: 'Jane',
                last_name: 'Doe',
                company_name: 'Acme Co',
                website: 'https://www.acmeco.com',
                linkedin_url: 'https://www.linkedin.com/in/janedoe',
                company_linkedin_url: 'https://www.linkedin.com/company/acme-co',
                custom_lead_data: {
                  company: 'Acme Co',
                  source: 'Landing Page',
                },
              },
            },
          },
        },
        responses: {
          201: jsonResponse('LeadUpsertResult', 'Lead created.', {
            data: {
              id: '9c3cb55a-5e5e-47b6-a95e-31461779ce92',
              campaign_id: '1d8dc901-3d2d-4d9f-9dcc-4f8b3aa1a1fb',
              email: 'jane@example.com',
              first_name: 'Jane',
              custom_lead_data: { company: 'Acme Co', source: 'Landing Page' },
              source: 'api',
              created_at: '2026-05-21T18:00:00.000Z',
            },
            created: true,
          }),
          200: jsonResponse('LeadUpsertResult', 'Lead updated or idempotent replay.'),
          ...authenticatedErrors('ValidationError', 'ForbiddenError', 'NotFoundError'),
        },
      },
    },
    '/v1/campaigns/{id}/leads/{leadId}': {
      get: {
        operationId: 'getLead',
        tags: ['Leads'],
        summary: 'Get lead',
        description: 'Returns one active lead in the campaign.',
        parameters: [parameterRef('CampaignId'), parameterRef('LeadId')],
        responses: {
          200: jsonResponse('LeadResponse', 'Lead response.'),
          ...authenticatedErrors('NotFoundError'),
        },
      },
      patch: {
        operationId: 'updateLead',
        tags: ['Leads'],
        summary: 'Update lead',
        description: 'Updates mutable lead fields and emits `lead.updated`.',
        parameters: [parameterRef('CampaignId'), parameterRef('LeadId')],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: schemaRef('LeadUpdate'),
              example: {
                first_name: 'Jane',
                company_name: 'Acme Incorporated',
                custom_lead_data: {
                  company: 'Acme Incorporated',
                  source: 'Manual import',
                },
              },
            },
          },
        },
        responses: {
          200: jsonResponse('LeadResponse', 'Updated lead.'),
          ...authenticatedErrors('ForbiddenError', 'NotFoundError'),
        },
      },
      delete: {
        operationId: 'deleteLead',
        tags: ['Leads'],
        summary: 'Delete lead',
        description: 'Soft-deletes the lead, stops its enrollments, cancels queued campaign message jobs, and emits `lead.deleted`.',
        parameters: [parameterRef('CampaignId'), parameterRef('LeadId')],
        responses: {
          200: jsonResponse('DeleteResponse', 'Lead deleted.', {
            data: { id: '9c3cb55a-5e5e-47b6-a95e-31461779ce92', deleted: true },
          }),
          ...authenticatedErrors('ForbiddenError', 'NotFoundError'),
        },
      },
    },
    '/v1/campaigns/{id}/leads/bulk': {
      post: {
        operationId: 'bulkSyncLeads',
        tags: ['Leads'],
        summary: 'Bulk sync leads',
        description: `Synchronously imports or upserts up to ${BULK_SYNC_LIMIT} leads in a single request. Per-row lead webhooks are suppressed; Furnace emits one \`lead.bulk_import.completed\` batch event. Supports idempotent retries with \`Idempotency-Key\`.`,
        parameters: [parameterRef('CampaignId'), parameterRef('IdempotencyKey')],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: schemaRef('BulkLeadsRequest'),
              example: {
                leads: [
                  {
                    email: 'jane@example.com',
                    first_name: 'Jane',
                    custom_lead_data: {
                      company: 'Acme Co',
                      source: 'Landing Page',
                    },
                  },
                  {
                    email: 'max@example.com',
                    first_name: 'Max',
                    custom_lead_data: {
                      company: 'Northwind',
                      source: 'Conference',
                    },
                  },
                ],
              },
            },
          },
        },
        responses: {
          200: jsonResponse('BulkLeadsResult', 'Bulk import results.', {
            imported: 2,
            incomplete: 0,
            failed: 0,
            errors: [],
          }),
          ...authenticatedErrors('ValidationError', 'ForbiddenError', 'NotFoundError'),
        },
      },
    },
    '/v1/campaigns/{id}/leads/bulk/async': {
      post: {
        operationId: 'queueAsyncLeadImport',
        tags: ['Jobs'],
        summary: 'Queue async lead import',
        description: `Queues an async import job for up to ${BULK_ASYNC_LIMIT} leads. Furnace allows at most ${MAX_ASYNC_JOBS_PER_ACCOUNT} queued or running async jobs per account at a time. Per-row \`lead.created\` / \`lead.updated\` webhooks are suppressed during processing; a single \`lead.bulk_import.completed\` event is emitted when the job completes successfully.`,
        parameters: [parameterRef('CampaignId')],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: schemaRef('AsyncBulkLeadsRequest'),
              example: {
                leads: [
                  {
                    email: 'jane@example.com',
                    first_name: 'Jane',
                    custom_lead_data: {
                      company: 'Acme Co',
                      source: 'Landing Page',
                    },
                  },
                ],
              },
            },
          },
        },
        responses: {
          202: jsonResponse('ImportJobResponse', 'Async import job queued.', {
            data: {
              id: '6a8584eb-0ee5-4d7d-8eb6-db9259914e18',
              campaign_id: '1d8dc901-3d2d-4d9f-9dcc-4f8b3aa1a1fb',
              account_id: '04bc2b35-a282-4581-a53f-50435d8309f1',
              created_by_api_key_id: 'a66d06b0-dfe0-420b-8c05-1e7301ad1514',
              status: 'queued',
              input: { leads: [{ email: 'jane@example.com' }] },
              result: {},
              errors: [],
            },
          }),
          ...authenticatedErrors('ValidationError', 'ForbiddenError', 'NotFoundError'),
        },
      },
    },
    '/v1/jobs': {
      post: {
        operationId: 'createAsyncJob',
        tags: ['Jobs'],
        summary: 'Create async bulk job',
        description: `Creates one logical async job for a supported bulk operation. Prefer server-side \`scope\` (+ optional \`exclusions\`) over inline ID batches. Running concurrency is capped at ${MAX_ASYNC_JOBS_PER_ACCOUNT} jobs per account; additional jobs remain queued. Poll \`GET /v1/jobs/{id}\`; cancel with \`POST /v1/jobs/{id}/cancel\`. One operation-specific \`*.completed\` webhook is emitted when the job finishes successfully.`,
        requestBody: jsonRequestBody('ImportJobCreate', {
          operation: 'add_to_campaign',
          campaign_id: '1d8dc901-3d2d-4d9f-9dcc-4f8b3aa1a1fb',
          scope: { kind: 'saved_list', list_id: '7c0d0f5a-2f61-4a2a-9f1d-1b2c3d4e5f60' },
        }),
        responses: {
          202: jsonResponse('ImportJobResponse', 'Async job queued.'),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
    },
    '/v1/campaigns/{id}/leads:add': {
      post: {
        operationId: 'syncAddLeadsToCampaign',
        tags: ['Leads'],
        summary: 'Sync add leads to campaign',
        description: `Adds up to ${BULK_SYNC_LIMIT} existing account people to a campaign by \`global_lead_id\`. Emits one \`lead.added_to_campaign.completed\` batch webhook.`,
        parameters: [parameterRef('CampaignId')],
        requestBody: jsonRequestBody('GlobalLeadIdsRequest'),
        responses: {
          200: jsonResponse('MembershipAddResponse', 'Leads added to campaign.'),
          ...authenticatedErrors('ValidationError', 'ForbiddenError', 'NotFoundError'),
        },
      },
    },
    '/v1/campaigns/{id}/leads:remove': {
      post: {
        operationId: 'syncRemoveLeadsFromCampaign',
        tags: ['Leads'],
        summary: 'Sync remove leads from campaign',
        description: `Removes up to ${BULK_SYNC_LIMIT} leads from a campaign by \`global_lead_id\`. Emits one \`lead.removed_from_campaign.completed\` batch webhook.`,
        parameters: [parameterRef('CampaignId')],
        requestBody: jsonRequestBody('GlobalLeadIdsRequest'),
        responses: {
          200: jsonResponse('MembershipRemoveResponse', 'Leads removed from campaign.'),
          ...authenticatedErrors('ValidationError', 'ForbiddenError', 'NotFoundError'),
        },
      },
    },
    '/v1/leads:remove-from-all-campaigns': {
      post: {
        operationId: 'syncRemoveLeadsFromAllCampaigns',
        tags: ['Leads'],
        summary: 'Sync remove leads from all campaigns',
        description: `Removes up to ${BULK_SYNC_LIMIT} people from every campaign in the account. Emits one \`lead.removed_from_all_campaigns.completed\` batch webhook.`,
        requestBody: jsonRequestBody('GlobalLeadIdsRequest'),
        responses: {
          200: jsonResponse('MembershipRemoveResponse', 'Leads removed from all campaigns.'),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
    },
    '/v1/people': {
      get: {
        operationId: 'listPeople',
        tags: ['People'],
        summary: 'List account people',
        description: 'Returns the account people explorer page with filters, sort, and pagination.',
        parameters: [
          parameterRef('Limit'),
          parameterRef('Offset'),
          parameterRef('PeopleSearch'),
          parameterRef('PeopleSort'),
          parameterRef('PeopleSortDirection'),
          parameterRef('GlobalLeadIdsQuery'),
          parameterRef('CampaignIdsQuery'),
        ],
        responses: {
          200: jsonResponse('PersonListResponse', 'Account people page.'),
          ...authenticatedErrors(),
        },
      },
    },
    '/v1/people/{globalLeadId}': {
      get: {
        operationId: 'getPerson',
        tags: ['People'],
        summary: 'Get person',
        description: 'Returns one account person and their campaign memberships.',
        parameters: [parameterRef('GlobalLeadId')],
        responses: {
          200: jsonResponse('PersonDetailResponse', 'Person detail.'),
          ...authenticatedErrors('NotFoundError'),
        },
      },
      patch: {
        operationId: 'updatePerson',
        tags: ['People'],
        summary: 'Update person profile',
        description: 'Updates profile fields on all lead rows for the given global lead id.',
        parameters: [parameterRef('GlobalLeadId')],
        requestBody: jsonRequestBody('PersonUpdate'),
        responses: {
          200: jsonResponse('PersonResponse', 'Updated person.'),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
    },
    '/v1/lead-lists': {
      get: {
        operationId: 'listLeadLists',
        tags: ['Lead lists'],
        summary: 'List saved lead lists',
        responses: {
          200: jsonResponse('LeadSavedListArrayResponse', 'Saved lead lists.'),
          ...authenticatedErrors(),
        },
      },
      post: {
        operationId: 'createLeadList',
        tags: ['Lead lists'],
        summary: 'Create saved lead list',
        requestBody: jsonRequestBody('LeadSavedListCreate'),
        responses: {
          201: jsonResponse('LeadSavedListResponse', 'Created lead list.'),
          ...authenticatedErrors('ValidationError'),
        },
      },
    },
    '/v1/lead-lists/{id}': {
      get: {
        operationId: 'getLeadList',
        tags: ['Lead lists'],
        summary: 'Get saved lead list',
        parameters: [parameterRef('LeadListId')],
        responses: {
          200: jsonResponse('LeadSavedListResponse', 'Lead list.'),
          ...authenticatedErrors('NotFoundError'),
        },
      },
      patch: {
        operationId: 'updateLeadList',
        tags: ['Lead lists'],
        summary: 'Update saved lead list',
        parameters: [parameterRef('LeadListId')],
        requestBody: jsonRequestBody('LeadSavedListUpdate'),
        responses: {
          200: jsonResponse('LeadSavedListResponse', 'Updated lead list.'),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
      delete: {
        operationId: 'deleteLeadList',
        tags: ['Lead lists'],
        summary: 'Delete saved lead list',
        parameters: [parameterRef('LeadListId')],
        responses: {
          200: jsonResponse('DeleteResponse', 'Lead list deleted.'),
          ...authenticatedErrors('NotFoundError'),
        },
      },
    },
    '/v1/lead-lists/{id}/people': {
      get: {
        operationId: 'listLeadListPeople',
        tags: ['Lead lists'],
        summary: 'List people in saved lead list',
        parameters: [parameterRef('LeadListId'), parameterRef('Limit'), parameterRef('Offset')],
        responses: {
          200: jsonResponse('PersonListResponse', 'People in list.'),
          ...authenticatedErrors('NotFoundError'),
        },
      },
    },
    '/v1/lead-lists/{id}/members': {
      post: {
        operationId: 'addLeadListMembers',
        tags: ['Lead lists'],
        summary: 'Add members to saved lead list',
        parameters: [parameterRef('LeadListId')],
        requestBody: jsonRequestBody('GlobalLeadIdsRequest'),
        responses: {
          200: jsonResponse('LeadListMembersResultResponse', 'Members added.'),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
      delete: {
        operationId: 'removeLeadListMembers',
        tags: ['Lead lists'],
        summary: 'Remove members from saved lead list',
        parameters: [parameterRef('LeadListId')],
        requestBody: jsonRequestBody('GlobalLeadIdsRequest'),
        responses: {
          200: jsonResponse('LeadListMembersResultResponse', 'Members removed.'),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
    },
    '/v1/jobs/{id}': {
      get: {
        operationId: 'getAsyncImportJob',
        tags: ['Jobs'],
        summary: 'Get async import job',
        description: 'Returns one async bulk job for the authenticated account.',
        parameters: [parameterRef('JobId')],
        responses: {
          200: jsonResponse('ImportJobResponse', 'Async import job.'),
          ...authenticatedErrors('NotFoundError'),
        },
      },
    },
    '/v1/jobs/{id}/cancel': {
      post: {
        operationId: 'cancelBulkJob',
        tags: ['Jobs'],
        summary: 'Cancel async bulk job',
        description:
          'Requests cancellation. Queued/uploading jobs become cancelled immediately; running jobs stop between chunks.',
        parameters: [parameterRef('JobId')],
        responses: {
          200: jsonResponse('ImportJobResponse', 'Cancellation requested.'),
          ...authenticatedErrors('NotFoundError'),
        },
      },
    },
    '/v1/mailboxes': {
      get: {
        operationId: 'listMailboxes',
        tags: ['Mailboxes'],
        summary: 'List mailboxes',
        description: 'Lists active account mailboxes. Furnace strips `smtp_password` and `imap_password` before returning each mailbox. Results can be filtered by mailbox tags.',
        parameters: [parameterRef('Limit'), parameterRef('Offset'), parameterRef('MailboxTagIds')],
        responses: {
          200: jsonResponse('MailboxListResponse', 'Mailbox page.'),
          ...authenticatedErrors(),
        },
      },
    },
    '/v1/mailboxes/{id}': {
      patch: {
        operationId: 'updateMailbox',
        tags: ['Mailboxes'],
        summary: 'Update mailbox',
        description: 'Updates mailbox tag assignments. Mailbox profile and credential fields remain read-only on the Client API.',
        parameters: [parameterRef('MailboxId')],
        requestBody: jsonRequestBody('MailboxUpdate'),
        responses: {
          200: jsonResponse('MailboxResponse', 'Updated mailbox.'),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
      get: {
        operationId: 'getMailbox',
        tags: ['Mailboxes'],
        summary: 'Get mailbox',
        description: 'Returns one mailbox without secret password fields.',
        parameters: [parameterRef('MailboxId')],
        responses: {
          200: jsonResponse('MailboxResponse', 'Mailbox response.'),
          ...authenticatedErrors('NotFoundError'),
        },
      },
    },
    '/v1/threads': {
      get: {
        operationId: 'listThreads',
        tags: ['Inbox'],
        summary: 'List inbox threads',
        description:
          'Lists inbox threads in the authenticated account. By default only threads with at least one inbound reply are returned. Newest/Oldest sort and `date_from`/`date_to` use `last_inbound_at` (latest lead reply). The `q` parameter searches subject, participants, lead identity/company, campaign name, thread tags, and message bodies.',
        parameters: [
          parameterRef('Limit'),
          parameterRef('Offset'),
          parameterRef('Search'),
          parameterRef('CampaignFilter'),
          parameterRef('MailboxFilter'),
          parameterRef('UnreadOnly'),
          parameterRef('ConversationStatusFilter'),
          parameterRef('ThreadCategoryFilter'),
          parameterRef('ThreadTagIdsFilter'),
          parameterRef('DateFrom'),
          parameterRef('DateTo'),
          parameterRef('HasReplyOnly'),
        ],
        responses: {
          200: jsonResponse('ThreadListResponse', 'Thread page.'),
          ...authenticatedErrors(),
        },
      },
    },
    '/v1/threads/{id}': {
      get: {
        operationId: 'getThread',
        tags: ['Inbox'],
        summary: 'Get thread',
        description: 'Returns one inbox thread.',
        parameters: [parameterRef('ThreadId')],
        responses: {
          200: jsonResponse('ThreadResponse', 'Thread response.'),
          ...authenticatedErrors('NotFoundError'),
        },
      },
      patch: {
        operationId: 'updateThread',
        tags: ['Inbox'],
        summary: 'Update thread',
        description: 'Updates thread category, conversation status, and/or read state. Category changes emit a `reply.categorized` webhook when configured.',
        parameters: [parameterRef('ThreadId')],
        requestBody: jsonRequestBody('ThreadUpdate', {
          category: 'Interested',
          conversation_status: 'closed',
          read: true,
        }),
        responses: {
          200: jsonResponse('ThreadResponse', 'Updated thread.'),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
    },
    '/v1/threads/{id}/messages': {
      get: {
        operationId: 'listThreadMessages',
        tags: ['Inbox'],
        summary: 'List thread messages',
        description: 'Lists messages in the thread ordered from oldest to newest.',
        parameters: [parameterRef('ThreadId')],
        responses: {
          200: jsonResponse('MessageListResponse', 'Thread messages.', {
            data: [
              {
                id: '306a0f4d-2aca-4d34-ab18-53a4b50b10eb',
                thread_id: 'f064bce3-eb45-4edf-b7d0-6d316846f4f6',
                direction: 'sent',
                subject: 'Furnace API thread',
                body_text: 'First touch',
                from_email: 'sender@example.com',
                to_email: 'lead@example.com',
                received_at: '2026-05-21T17:59:00.000Z',
              },
            ],
          }),
          ...authenticatedErrors('NotFoundError'),
        },
      },
    },
    '/v1/threads/{id}/reply': {
      post: {
        operationId: 'createReplyJob',
        tags: ['Inbox'],
        summary: 'Create reply job',
        description: 'Creates an outbound inbox reply job. When `in_reply_to_message_id` is omitted, Furnace targets the latest message in the thread.',
        parameters: [parameterRef('ThreadId')],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: schemaRef('ReplyRequest'),
              example: {
                body_text: 'Thanks for the reply.',
              },
            },
          },
        },
        responses: {
          202: jsonResponse('ReplyJobResponse', 'Reply job queued.', {
            data: { id: '7e9f1f62-27f6-4474-b22c-7197e5480de4' },
          }),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
    },
    '/v1/threads/{id}/forward': {
      post: {
        operationId: 'createForwardJob',
        tags: ['Inbox'],
        summary: 'Create forward job',
        description: 'Creates an outbound inbox forward job for a specific message in the thread.',
        parameters: [parameterRef('ThreadId')],
        requestBody: jsonRequestBody('ForwardRequest', {
          forward_message_id: '306a0f4d-2aca-4d34-ab18-53a4b50b10eb',
          to_email: 'referral@example.com',
          body_text: 'Sharing this thread.',
        }),
        responses: {
          202: jsonResponse('ReplyJobResponse', 'Forward job queued.'),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
    },
    '/v1/threads/{id}/out-of-office': {
      put: {
        operationId: 'setThreadOutOfOffice',
        tags: ['Inbox'],
        summary: 'Set out of office',
        description: 'Marks a thread out of office and optionally schedules campaign resume.',
        parameters: [parameterRef('ThreadId')],
        requestBody: jsonRequestBody('OutOfOfficeUpdate', {
          resume_mode: 'scheduled',
          resume_at: '2026-07-01T00:00:00.000Z',
        }),
        responses: {
          200: jsonResponse('OutOfOfficeResponse', 'Out-of-office updated.'),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
      delete: {
        operationId: 'clearThreadOutOfOffice',
        tags: ['Inbox'],
        summary: 'Clear out of office',
        description: 'Clears out-of-office state for a thread.',
        parameters: [parameterRef('ThreadId')],
        responses: {
          200: jsonResponse('ThreadResponse', 'Out-of-office cleared.'),
          ...authenticatedErrors('NotFoundError'),
        },
      },
    },
    '/v1/threads/{id}/replace-lead/preview': {
      get: {
        operationId: 'previewThreadLeadReplacement',
        tags: ['Inbox'],
        summary: 'Preview replace lead',
        description:
          'Read-only preview of what `replaceThreadLead` would do for a candidate email on this thread. Call this before writing when you need to know whether the address will create a new contact or attach to an existing campaign lead, whether the address is on the block list, and whether the attach would be refused (same email as the current lead, or existing contact with no live enrollment). `mode`, `allowed`, and `disallowed_reason` use the same vocabulary as the write path errors.',
        parameters: [
          parameterRef('ThreadId'),
          {
            name: 'email',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'email' },
            description: 'Candidate replacement email to preview.',
          },
        ],
        responses: {
          200: jsonResponse('ReplaceLeadPreviewResponse', 'Replacement preview.'),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
    },
    '/v1/threads/{id}/replace-lead': {
      post: {
        operationId: 'replaceThreadLead',
        tags: ['Inbox'],
        summary: 'Replace lead',
        description:
          'Replaces the thread lead with a new contact and optionally queues a forward job.\n\nTwo modes, reported in the response `mode` field:\n- `created` — the address is new to this campaign. A lead is inserted, the conversation moves to them, and the original lead is archived.\n- `attached` — the address is already a live lead in this campaign. That existing contact is reused (their profile and sequence stay as they are), the conversation moves to them, the original lead is retired as stopped/replaced, and any duplicate rows for the same address have their sequences stopped (`retired_sibling_count`). On attach, `new_lead_id` and `target_lead_id` are that pre-existing contact.\n\nAttach happens automatically when the address matches; there is no opt-in flag. The call fails with 409 `target_missing_enrollment` when the existing contact has no live enrollment (nothing to send against). Prefer calling `previewThreadLeadReplacement` first to inspect `mode`, `allowed`, block-list status, and `disallowed_reason` before writing.',
        parameters: [parameterRef('ThreadId')],
        requestBody: jsonRequestBody('ReplaceLeadRequest', {
          new_email: 'referral@example.com',
          new_name: 'Jane Doe',
        }),
        responses: {
          200: jsonResponse('ReplaceLeadResponse', 'Lead replaced.'),
          ...authenticatedErrors('ValidationError', 'ForbiddenError', 'NotFoundError', 'ConflictError'),
        },
      },
    },
    '/v1/threads/{id}/tags:add': {
      post: {
        operationId: 'addThreadTag',
        tags: ['Inbox'],
        summary: 'Add thread tag',
        description: 'Assigns an existing account thread tag to the thread.',
        parameters: [parameterRef('ThreadId')],
        requestBody: jsonRequestBody('ThreadTagAssignmentRequest', {
          tag_id: '1d8dc901-3d2d-4d9f-9dcc-4f8b3aa1a1fb',
        }),
        responses: {
          200: jsonResponse('ThreadTagAssignmentResponse', 'Tag assigned.'),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
    },
    '/v1/threads/{id}/tags:remove': {
      post: {
        operationId: 'removeThreadTag',
        tags: ['Inbox'],
        summary: 'Remove thread tag',
        description: 'Removes a thread tag assignment from the thread.',
        parameters: [parameterRef('ThreadId')],
        requestBody: jsonRequestBody('ThreadTagAssignmentRequest', {
          tag_id: '1d8dc901-3d2d-4d9f-9dcc-4f8b3aa1a1fb',
        }),
        responses: {
          200: jsonResponse('ThreadTagAssignmentResponse', 'Tag removed.'),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
    },
    '/v1/thread-tags': {
      get: {
        operationId: 'listThreadTags',
        tags: ['Inbox'],
        summary: 'List thread tags',
        description: 'Lists account thread tags available for assignment.',
        responses: {
          200: jsonResponse('ThreadTagListResponse', 'Thread tags.'),
          ...authenticatedErrors(),
        },
      },
    },
    '/v1/message-jobs/{id}': {
      get: {
        operationId: 'getMessageJob',
        tags: ['Inbox'],
        summary: 'Get message job',
        description: 'Returns the status of an outbound inbox reply or forward job.',
        parameters: [parameterRef('MessageJobId')],
        responses: {
          200: jsonResponse('MessageJobResponse', 'Message job status.'),
          ...authenticatedErrors('NotFoundError'),
        },
      },
    },
    '/v1/message-jobs/{id}/cancel': {
      post: {
        operationId: 'cancelMessageJob',
        tags: ['Inbox'],
        summary: 'Cancel message job',
        description: 'Cancels a queued or failed outbound inbox message job.',
        parameters: [parameterRef('MessageJobId')],
        responses: {
          200: jsonResponse('MessageJobResponse', 'Cancelled message job.'),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
    },
    '/v1/message-jobs/{id}/send-now': {
      post: {
        operationId: 'sendMessageJobNow',
        tags: ['Inbox'],
        summary: 'Send message job now',
        description: 'Requests immediate send for a queued outbound inbox message job.',
        parameters: [parameterRef('MessageJobId')],
        responses: {
          200: jsonResponse('MessageJobResponse', 'Updated message job.'),
          ...authenticatedErrors('ValidationError', 'NotFoundError'),
        },
      },
    },
    '/v1/block-list': {
      get: {
        operationId: 'listBlockListEntries',
        tags: ['Block list'],
        summary: 'List block list',
        description: 'Lists block-list entries in the authenticated account.',
        parameters: [parameterRef('Limit'), parameterRef('Offset'), parameterRef('Search')],
        responses: {
          200: jsonResponse('BlockListListResponse', 'Block-list page.'),
          ...authenticatedErrors(),
        },
      },
      post: {
        operationId: 'createBlockListEntry',
        tags: ['Block list'],
        summary: 'Add block list entry',
        description: 'Creates a block-list entry for an email address or domain. If an identical entry already exists, Furnace returns the existing row instead of creating a duplicate.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: schemaRef('BlockListCreate'),
              example: {
                value: 'blocked@example.com',
                type: 'email',
                reason: 'manual',
              },
            },
          },
        },
        responses: {
          201: jsonResponse('BlockListResponse', 'Block-list entry created.', {
            data: {
              id: 'eb3a28d2-7328-4d02-9dad-4d1ee61d1952',
              account_id: '04bc2b35-a282-4581-a53f-50435d8309f1',
              value: 'blocked@example.com',
              type: 'email',
              reason: 'manual',
            },
          }),
          200: jsonResponse('BlockListResponse', 'Block-list entry already existed.'),
          ...authenticatedErrors('ValidationError'),
        },
      },
    },
    '/v1/block-list/{id}': {
      delete: {
        operationId: 'deleteBlockListEntry',
        tags: ['Block list'],
        summary: 'Delete block list entry',
        description: 'Deletes a block-list entry in the authenticated account.',
        parameters: [parameterRef('BlockListId')],
        responses: {
          200: jsonResponse('DeleteResponse', 'Block-list entry deleted.', {
            data: { id: 'eb3a28d2-7328-4d02-9dad-4d1ee61d1952', deleted: true },
          }),
          ...authenticatedErrors(),
        },
      },
    },
    '/v1/campaigns/{id}/stats': {
      get: {
        operationId: 'getCampaignStats',
        tags: ['Stats'],
        summary: 'Campaign stats',
        description: 'Returns daily and aggregate campaign stats. When `start_date` and `end_date` are omitted, Furnace defaults the range to campaign creation date through today.',
        parameters: [parameterRef('CampaignId'), parameterRef('StartDate'), parameterRef('EndDate')],
        responses: {
          200: jsonResponse('CampaignStatsResponse', 'Campaign stats.', {
            data: {
              daily: [
                {
                  date: '2026-05-20',
                  sent: 15,
                  replied: 3,
                  positiveReply: 1,
                  bounce: 0,
                },
              ],
              totals: {
                sentCount: 15,
                repliedCount: 3,
                positiveReplyCount: 1,
                bounceCount: 0,
                lastBounceAt: null,
                enrollmentCount: 42,
                terminalEnrollmentCount: 9,
                contactedEnrollmentCount: 12,
              },
            },
          }),
          ...authenticatedErrors('NotFoundError'),
        },
      },
    },
    '/v1/webhooks': {
      get: {
        operationId: 'getWebhookSettings',
        tags: ['Webhooks'],
        summary: 'Get webhook settings',
        description: 'Returns account-level webhook URL, signing secret, and enabled event types.',
        responses: {
          200: jsonResponse('WebhookSettingsResponse', 'Webhook settings.'),
          ...authenticatedErrors(),
        },
      },
      put: {
        operationId: 'updateWebhookSettings',
        tags: ['Webhooks'],
        summary: 'Update webhook settings',
        description: 'Updates account-level webhook URL, signing secret, and/or enabled events.',
        requestBody: jsonRequestBody('WebhookSettingsUpdate'),
        responses: {
          200: jsonResponse('WebhookSettingsResponse', 'Updated webhook settings.'),
          ...authenticatedErrors('ValidationError'),
        },
      },
    },
    '/v1/api-keys': {
      get: {
        operationId: 'listApiKeys',
        tags: ['API keys'],
        summary: 'List API keys',
        description: 'Lists account API keys. Secrets are never returned on list.',
        responses: {
          200: jsonResponse('ApiKeyListResponse', 'API key list.'),
          ...authenticatedErrors(),
        },
      },
      post: {
        operationId: 'createApiKey',
        tags: ['API keys'],
        summary: 'Create API key',
        description: 'Creates an API key. The full secret is returned once in this response.',
        requestBody: jsonRequestBody('ApiKeyCreate'),
        responses: {
          201: jsonResponse('ApiKeyCreatedResponse', 'Created API key with secret.'),
          ...authenticatedErrors('ValidationError'),
        },
      },
    },
    '/v1/api-keys/{id}': {
      delete: {
        operationId: 'revokeApiKey',
        tags: ['API keys'],
        summary: 'Revoke API key',
        description: 'Revokes an API key. Subsequent requests with that secret return 401.',
        parameters: [parameterRef('ApiKeyId')],
        responses: {
          200: jsonResponse('ApiKeyResponse', 'Revoked API key.'),
          ...authenticatedErrors('NotFoundError'),
        },
      },
    },
    '/v1/mailboxes/connect-sessions': {
      post: {
        operationId: 'createMailboxConnectSession',
        tags: ['Mailboxes'],
        summary: 'Start mailbox connect',
        description:
          'Creates a mailbox connect session and returns a `connect_url` to complete mailbox provisioning in the Furnace app. Poll the session for status.',
        responses: {
          201: jsonResponse('MailboxConnectSessionResponse', 'Mailbox connect session.'),
          ...authenticatedErrors(),
        },
      },
    },
    '/v1/mailboxes/connect-sessions/{id}': {
      get: {
        operationId: 'getMailboxConnectSession',
        tags: ['Mailboxes'],
        summary: 'Get mailbox connect session',
        description: 'Returns mailbox connect session status (`pending`, `completed`, `expired`, or `failed`).',
        parameters: [parameterRef('MailboxConnectSessionId')],
        responses: {
          200: jsonResponse('MailboxConnectSessionResponse', 'Mailbox connect session.'),
          ...authenticatedErrors('NotFoundError'),
        },
      },
    },
  };
}
