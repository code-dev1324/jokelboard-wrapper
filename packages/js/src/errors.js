export class JokelboardError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} status
   * @param {unknown} [raw]
   */
  constructor(code, message, status, raw) {
    super(message);
    this.name = 'JokelboardError';
    this.code = code;
    this.status = status;
    this.raw = raw ?? null;
  }
}

export class JokelboardConfigurationError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'JokelboardConfigurationError';
    this.code = 'configuration_error';
  }
}

export class RateLimitError extends JokelboardError {
  /**
   * @param {string} message
   * @param {number} retryAfter
   * @param {unknown} [raw]
   */
  constructor(message, retryAfter, raw) {
    super('rate_limited', message, 429, raw);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class RevisionConflictError extends JokelboardError {
  /**
   * @param {string} message
   * @param {number} currentRevision
   * @param {unknown} [raw]
   */
  constructor(message, currentRevision, raw) {
    super('revision_conflict', message, 409, raw);
    this.name = 'RevisionConflictError';
    this.currentRevision = currentRevision;
  }
}
