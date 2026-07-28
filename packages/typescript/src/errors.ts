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
  | 'rate_limited'
  | 'invalid_data'
  | 'invalid_card_patch'
  | 'invalid_type'
  | 'name_required'
  | 'name_reserved'
  | 'bot_name_invalid'
  | 'avatar_invalid'
  | 'text_required'
  | 'gone'
  | 'http_error'
  | 'network_error'
  | 'request_timeout'
  | 'invalid_response'
  | 'configuration_error'
  | (string & {});

export interface ErrorContext {
  method?: string | null;
  path?: string | null;
}

export interface ErrorJSON {
  name: string;
  message: string;
  code: string;
  status: number | null;
  method: string | null;
  path: string | null;
  retryable: boolean;
}

export class JokelboardError extends Error {
  readonly code: ErrorCode;
  readonly status: number | null;
  readonly raw: unknown;
  readonly method: string | null;
  readonly path: string | null;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, status: number | null, raw?: unknown, context: ErrorContext = {}) {
    super(message);
    this.name = 'JokelboardError';
    this.code = code;
    this.status = status ?? null;
    this.raw = raw ?? null;
    this.method = context.method ?? null;
    this.path = context.path ?? null;
    this.retryable = status === null || status === 429 || status >= 500 || code === 'revision_conflict';
  }

  toJSON(): ErrorJSON {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      status: this.status,
      method: this.method,
      path: this.path,
      retryable: this.retryable,
    };
  }
}

export class JokelboardConfigurationError extends Error {
  readonly code = 'configuration_error';
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'JokelboardConfigurationError';
  }

  toJSON() {
    return { name: this.name, message: this.message, code: this.code, retryable: false };
  }
}

export class RateLimitError extends JokelboardError {
  readonly retryAfter: number;

  constructor(message: string, retryAfter: number, raw?: unknown, context?: ErrorContext) {
    super('rate_limited', message, 429, raw, context);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class RevisionConflictError extends JokelboardError {
  readonly currentRevision: number | null;

  constructor(message: string, currentRevision: number | null, raw?: unknown, context?: ErrorContext) {
    super('revision_conflict', message, 409, raw, context);
    this.name = 'RevisionConflictError';
    this.currentRevision = currentRevision;
  }
}
