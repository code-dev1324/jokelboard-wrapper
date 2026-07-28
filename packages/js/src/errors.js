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
    this.raw = raw;
  }
}

export class RateLimitError extends JokelboardError {
  /**
   * @param {string} message
   * @param {number} retryAfter
   * @param {number} limit
   * @param {number} windowMs
   * @param {unknown} [raw]
   */
  constructor(message, retryAfter, limit, windowMs, raw) {
    super('card_rate_limited', message, 429, raw);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    this.limit = limit;
    this.windowMs = windowMs;
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
