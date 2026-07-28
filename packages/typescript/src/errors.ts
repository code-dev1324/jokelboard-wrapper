export type ErrorCode =
  | 'api_token_required'
  | 'invalid_api_token'
  | 'api_scope_required'
  | 'insufficient_scope'
  | 'api_access_blocked'
  | 'plugin_api_access_blocked'
  | 'board_scope_violation'
  | 'profile_scope_violation'
  | 'org_scope_violation'
  | 'plugin_not_supported_for_org_tokens'
  | 'forbidden'
  | 'vault_access_required'
  | 'not_found'
  | 'list_not_found'
  | 'card_not_found'
  | 'item_not_found'
  | 'no_checklist'
  | 'revision_conflict'
  | 'list_exists'
  | 'card_exists'
  | 'card_rate_limited'
  | 'invalid_data'
  | 'invalid_card_patch'
  | 'invalid_type'
  | 'name_required'
  | 'name_reserved'
  | 'bot_name_invalid'
  | 'avatar_invalid'
  | 'text_required'
  | 'gone'
  | (string & {});

export class JokelboardError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly raw: unknown;

  constructor(code: ErrorCode, message: string, status: number, raw?: unknown) {
    super(message);
    this.name = 'JokelboardError';
    this.code = code;
    this.status = status;
    this.raw = raw;
  }
}

export class RateLimitError extends JokelboardError {
  readonly retryAfter: number;
  readonly limit: number;
  readonly windowMs: number;

  constructor(message: string, retryAfter: number, limit: number, windowMs: number, raw?: unknown) {
    super('card_rate_limited', message, 429, raw);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    this.limit = limit;
    this.windowMs = windowMs;
  }
}

export class RevisionConflictError extends JokelboardError {
  readonly currentRevision: number;

  constructor(message: string, currentRevision: number, raw?: unknown) {
    super('revision_conflict', message, 409, raw);
    this.name = 'RevisionConflictError';
    this.currentRevision = currentRevision;
  }
}
