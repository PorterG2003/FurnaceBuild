import {
  BULK_ASYNC_LIMIT,
  BULK_SYNC_LIMIT,
  IMPORT_JOB_OPERATIONS,
  MAX_ASYNC_JOBS_PER_ACCOUNT,
} from './constants.js';
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
    ...Object.fromEntries(extraNames.map((name) => [name === 'ValidationError' ? 400 : name === 'ForbiddenError' ? 403 : name === 'NotFoundError' ? 404 : 500, responseRef(name)])),
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
    '/docs': {
      get: {
        operationId: 'getDocs',
        tags: ['Meta'],
        summary: 'Scalar docs',
        description: 'Returns the hosted Scalar API reference UI backed by `/openapi.json`.',
        security: [],
        responses: {
          200: {
            description: 'Scalar API reference HTML.',
            content: {
              'text/html': {
                schema: schemaRef('DocsHtml'),
              },
            },
          },
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
    '/v1/campaigns/{id}/pause': {
      post: {
        operationId: 'pauseCampaign',
        tags: ['Campaigns'],
        summary: 'Pause campaign',
        description: 'Pauses a running campaign and emits the `campaign.paused` webhook event.',
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
        summary: 'Stop campaign',
        description: 'Stops a campaign, stops active enrollments, and emits the `campaign.stopped` webhook event.',
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
        summary: 'Resume campaign',
        description: 'Resumes a paused campaign and emits the `campaign.resumed` webhook event. Furnace rejects resume requests unless the current campaign status is `paused`.',
        parameters: [parameterRef('CampaignId')],
        responses: {
          200: jsonResponse('CampaignStatusResponse', 'Campaign resumed.', {
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
        tags: ['Campaigns'],
        summary: 'Get campaign flow',
        description: 'Returns the campaign flow graph. If a campaign has no saved flow, Furnace returns an empty `{ nodes: [], edges: [] }` payload.',
        parameters: [parameterRef('CampaignId')],
        responses: {
          200: jsonResponse('CampaignFlowResponse', 'Campaign flow.', {
            data: {
              nodes: [
                {
                  id: 'lead-source-1',
                  type: 'leadSource',
                  data: {
                    customFieldKeys: ['company', 'source'],
                    mappedStandardFieldKeys: ['email', 'first_name', 'last_name'],
                  },
                },
              ],
              edges: [],
            },
          }),
          ...authenticatedErrors('NotFoundError'),
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
        tags: ['Leads', 'Jobs'],
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
        description: `Creates an async job for any supported bulk operation. Poll \`GET /v1/jobs/{id}\` for completion. Furnace allows at most ${MAX_ASYNC_JOBS_PER_ACCOUNT} queued or running async jobs per account. One operation-specific \`*.completed\` webhook is emitted when the job finishes successfully.`,
        requestBody: jsonRequestBody('ImportJobCreate', {
          operation: 'add_to_campaign',
          campaign_id: '1d8dc901-3d2d-4d9f-9dcc-4f8b3aa1a1fb',
          global_lead_ids: ['abc123'],
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
          200: jsonResponse('BulkMembershipActionResponse', 'Leads added to campaign.'),
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
          200: jsonResponse('BulkMembershipActionResponse', 'Leads removed from campaign.'),
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
          200: jsonResponse('BulkMembershipActionResponse', 'Leads removed from all campaigns.'),
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
        tags: ['Lead lists', 'People'],
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
        description: 'Returns one async lead import job for the authenticated account.',
        parameters: [parameterRef('JobId')],
        responses: {
          200: jsonResponse('ImportJobResponse', 'Async import job.'),
          ...authenticatedErrors('NotFoundError'),
        },
      },
    },
    '/v1/mailboxes': {
      get: {
        operationId: 'listMailboxes',
        tags: ['Mailboxes'],
        summary: 'List mailboxes',
        description: 'Lists active account mailboxes. Furnace strips `smtp_password` and `imap_password` before returning each mailbox.',
        parameters: [parameterRef('Limit'), parameterRef('Offset')],
        responses: {
          200: jsonResponse('MailboxListResponse', 'Mailbox page.'),
          ...authenticatedErrors(),
        },
      },
    },
    '/v1/mailboxes/{id}': {
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
        description: 'Lists inbox threads in the authenticated account. Results can be filtered by campaign or mailbox.',
        parameters: [
          parameterRef('Limit'),
          parameterRef('Offset'),
          parameterRef('CampaignFilter'),
          parameterRef('MailboxFilter'),
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
        description: 'Creates an outbound inbox reply job targeting the latest message in the thread. When subject or recipients are omitted, Furnace falls back to the most recent inbound/outbound message metadata.',
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
  };
}
