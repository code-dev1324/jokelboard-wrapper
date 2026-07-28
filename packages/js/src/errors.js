export class JokelboardError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number|null} status
   * @param {unknown} [raw]
   * @param {{ method?: string|null, path?: string|null }} [context]
   */
  constructor(code, message, status, raw, context = {}) {
    super(message);
    this.name = 'JokelboardError';
    this.code = code;
    this.status = status ?? null;
    this.raw = raw ?? null;
    this.method = context.method ?? null;
    this.path = context.path ?? null;
    this.retryable = status === null || status === 429 || status >= 500 || code === 'revision_conflict';
  }

  toJSON() {
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
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'JokelboardConfigurationError';
    this.code = 'configuration_error';
    this.retryable = false;
  }

  toJSON() {
    return { name: this.name, message: this.message, code: this.code, retryable: false };
  }
}

export class RateLimitError extends JokelboardError {
  /**
   * @param {string} message
   * @param {number} retryAfter
   * @param {unknown} [raw]
   * @param {{ method?: string|null, path?: string|null }} [context]
   */
  constructor(message, retryAfter, raw, context) {
    super('rate_limited', message, 429, raw, context);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class RevisionConflictError extends JokelboardError {
  /**
   * @param {string} message
   * @param {number|null} currentRevision
   * @param {unknown} [raw]
   * @param {{ method?: string|null, path?: string|null }} [context]
   */
  constructor(message, currentRevision, raw, context) {
    super('revision_conflict', message, 409, raw, context);
    this.name = 'RevisionConflictError';
    this.currentRevision = currentRevision;
  }
}
