import { ClientApiError, type ClientApiErrorShape } from './errors.js';

export type MappedReplaceLeadError = {
  status: number;
  code: string;
  message: string;
  param?: string;
  type: ClientApiErrorShape['error']['type'];
};

const REPLACEMENT_REASONS = [
  'auto_reply_forward',
  'manual_referral',
  'wrong_contact',
  'role_change',
  'other',
] as const;

export type ReplacementReason = (typeof REPLACEMENT_REASONS)[number];

export function isReplacementReason(value: string): value is ReplacementReason {
  return (REPLACEMENT_REASONS as readonly string[]).includes(value);
}

export const REPLACEMENT_REASON_VALUES = REPLACEMENT_REASONS;

/**
 * Map replace_lead_with_new_contact RAISE EXCEPTION text to structured Client API
 * errors. Endpoint-scoped so these regexes cannot misfire on other routes.
 */
export function mapReplaceLeadRpcError(message: string): MappedReplaceLeadError | null {
  if (/Lead not found or already removed/i.test(message)) {
    return {
      status: 404,
      code: 'lead_not_found',
      message: 'Lead not found or already removed',
      type: 'invalid_request_error',
    };
  }
  if (/^Forbidden$/i.test(message.trim()) || /Account membership required/i.test(message)) {
    return {
      status: 403,
      code: 'forbidden',
      message: 'Not allowed to replace this lead',
      type: 'permission_error',
    };
  }
  if (/Lead already has a replacement/i.test(message)) {
    return {
      status: 409,
      code: 'lead_already_replaced',
      message: 'This lead has already been replaced',
      type: 'invalid_request_error',
    };
  }
  if (/Replacement email must differ from the original lead email/i.test(message)) {
    return {
      status: 400,
      code: 'same_as_current_lead',
      message: 'Replacement email must differ from the original lead email',
      param: 'new_email',
      type: 'invalid_request_error',
    };
  }
  if (/source_message_id does not belong to this account/i.test(message)) {
    return {
      status: 400,
      code: 'invalid_source_message',
      message: 'source_message_id does not belong to this account',
      param: 'source_message_id',
      type: 'invalid_request_error',
    };
  }
  if (/has already been replaced by someone else/i.test(message)) {
    return {
      status: 409,
      code: 'target_already_replaced',
      message:
        'The existing contact for this address has already been replaced by someone else',
      type: 'invalid_request_error',
    };
  }
  if (/has no active enrollment in this campaign/i.test(message)) {
    return {
      status: 409,
      code: 'target_missing_enrollment',
      message:
        'The existing contact for this address has no active enrollment in this campaign; launch the campaign or re-add the contact before replacing. Call GET /v1/threads/{id}/replace-lead/preview to inspect the match first.',
      type: 'invalid_request_error',
    };
  }
  return null;
}

/** Throw a ClientApiError when the RPC message matches a known business rule. */
export function throwIfReplaceLeadRpcError(message: string): void {
  const mapped = mapReplaceLeadRpcError(message);
  if (!mapped) return;
  throw new ClientApiError(
    mapped.status,
    mapped.code,
    mapped.message,
    mapped.type,
    mapped.param,
  );
}
