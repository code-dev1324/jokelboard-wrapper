import { JokelboardError, JokelboardConfigurationError, RateLimitError, RevisionConflictError } from './errors.js';

const DEFAULT_BASE_URL = 'https://api.jokelboard.com/api/v1';
const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_CONFLICT_RETRIES = 1;

// ---- Helpers ----

/**
 * Normalises and validates the base URL. Enforces HTTPS (except localhost),
 * strips trailing slashes, and rejects embedded credentials, query strings, and hashes.
 * @param {string} value
 * @returns {string}
 */
function normaliseBaseUrl(value) {
  let url;
  try {
    url = new URL(value || DEFAULT_BASE_URL);
  } catch {
    throw new JokelboardConfigurationError('baseUrl must be a valid URL.');
  }

  if (url.username || url.password) {
    throw new JokelboardConfigurationError('baseUrl must not contain credentials.');
  }
  if (url.search || url.hash) {
    throw new JokelboardConfigurationError('baseUrl must not contain a query string or hash.');
  }

  const local = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local.has(url.hostname))) {
    throw new JokelboardConfigurationError('baseUrl must use HTTPS.');
  }

  return url.toString().replace(/\/+$/, '');
}

/**
 * Asserts that a value is a non-empty string or number and returns it as a trimmed string.
 * @param {unknown} value
 * @param {string} name
 * @returns {string}
 */
function requireId(value, name) {
  if ((typeof value !== 'string' && typeof value !== 'number') || !String(value).trim()) {
    throw new JokelboardConfigurationError(`${name} must be a non-empty string or number.`);
  }
  return String(value).trim();
}

/**
 * Like requireId but also percent-encodes the value for use in URL segments.
 * @param {unknown} value
 * @param {string} name
 * @returns {string}
 */
function encodeId(value, name) {
  return encodeURIComponent(requireId(value, name));
}

/**
 * Escapes < and > in comment text to avoid injection into card activity feeds.
 * @param {string} text
 * @returns {string}
 */
function sanitiseComment(text) {
  return text.replace(/[<>]/g, c => (c === '<' ? '&lt;' : '&gt;'));
}

/**
 * Walks all lists on a board and returns the first card matching the predicate,
 * along with its parent list. Returns null when nothing matches.
 * @param {object} board
 * @param {(card: object, list: object) => boolean} predicate
 * @returns {{ card: object, list: object } | null}
 */
export function findCard(board, predicate) {
  for (const list of board?.data?.lists ?? []) {
    for (const card of Array.isArray(list.cards) ? list.cards : []) {
      if (predicate(card, list)) return { card, list };
    }
  }
  return null;
}

/**
 * Recursively replaces all occurrences of token in value with '[REDACTED]'.
 * Prevents API tokens from leaking into error objects.
 * @param {unknown} value
 * @param {string} token
 * @returns {unknown}
 */
function redactToken(value, token) {
  if (typeof value === 'string') return value.split(token).join('[REDACTED]');
  if (Array.isArray(value)) return value.map(v => redactToken(v, token));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactToken(v, token)]));
  }
  return value;
}

/** @param {number} ms @returns {Promise<void>} */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- Board-scoped proxy ----

class BoardClient {
  /**
   * @param {JokelboardClient} api
   * @param {string} boardId
   */
  constructor(api, boardId) {
    this._api = api;
    this.id = boardId;

    this.lists = Object.freeze({
      create: (title) => api.createList(boardId, title),
    });

    this.cards = Object.freeze({
      create: (listId, title, options) => api.createCard(boardId, listId, title, options),
      update: (cardId, fields) => api.updateCard(boardId, cardId, fields),
      patch: (cardId, patchOrFn) => api.patchCard(boardId, cardId, patchOrFn),
      comment: (cardId, text, options) => api.addComment(boardId, cardId, text, options),
      move: (cardId, toListId, options) => api.moveCard(boardId, cardId, toListId, options),
      link: (cardId) => api.getCardLink(boardId, cardId),
      vault: (cardId) => api.vaultCard(boardId, cardId),
      restore: (cardId, options) => api.restoreCard(boardId, cardId, options),
      find: (predicate) => api.findCard(boardId, predicate),
      customField: (cardId, key) => api.getCustomField(boardId, cardId, key),
      customFields: (cardId) => api.getCustomFields(boardId, cardId),
      setCustomField: (cardId, key, value) => api.setCustomField(boardId, cardId, key, value),
      setCustomFields: (cardId, fields) => api.setCustomFields(boardId, cardId, fields),
    });

    this.vault = Object.freeze({
      list: () => api.getVault(boardId),
      purge: (cardId, revision) => api.purgeCard(boardId, cardId, revision),
    });

    this.plugin = Object.freeze({
      get: () => api.plugin.getBoard(boardId),
      toggleChecklistItem: (cardId, itemId) => api.plugin.toggleChecklistItem(boardId, cardId, itemId),
    });

    this.cards = Object.freeze({
      ...this.cards,
      get: (cardId) => api.getCard(boardId, cardId),
      findByTitle: (title) => api.findCardByTitle(boardId, title),
      findById: (cardId) => api.findCardById(boardId, cardId),
    });

    Object.freeze(this);
  }

  /** @returns {Promise<object>} */
  /** @returns {Promise<object[]>} */
  getLists() { return this._api.getLists(this.id); }

  get() { return this._api.getBoard(this.id); }

  /**
   * @param {object} boardData
   * @param {number} [revision]
   * @returns {Promise<object>}
   */
  replace(boardData, revision) { return this._api.replaceBoard(this.id, boardData, revision); }

  /**
   * @param {(ctx: { revision: number, board: object, boardClient: BoardClient, attempt: number }) => Promise<any>} operation
   * @param {{ retries?: number }} [options]
   * @returns {Promise<any>}
   */
  withFreshRevision(operation, options) {
    return this._api.withFreshRevision(this.id, operation, options);
  }
}

// ---- Main client ----

export class JokelboardClient {
  /**
   * @param {object} options
   * @param {string} options.token - Jokelboard API token (jkb_...)
   * @param {string} [options.defaultBoardId] - Default board ID used when boardId is omitted
   * @param {string} [options.baseUrl] - Override API base URL
   * @param {number} [options.timeout] - Request timeout in ms (default: 10000)
   * @param {boolean} [options.retryOnRateLimit] - Auto-retry on 429 (default: true)
   * @param {number} [options.maxRetries] - Max 429 retry attempts (default: 3)
   * @param {number} [options.maxConflictRetries] - Max revision-conflict retries (default: 1)
   * @param {typeof fetch} [options.fetchImpl] - Custom fetch implementation (for testing)
   */
  constructor({
    token,
    defaultBoardId = null,
    baseUrl = DEFAULT_BASE_URL,
    timeout = DEFAULT_TIMEOUT,
    retryOnRateLimit = true,
    maxRetries = DEFAULT_MAX_RETRIES,
    maxConflictRetries = DEFAULT_MAX_CONFLICT_RETRIES,
    fetchImpl = null,
  }) {
    const t = requireId(token, 'token');
    if (!t.startsWith('jkb_') || t.length > 256 || /\s/.test(t)) {
      throw new JokelboardConfigurationError('token is not a valid Jokelboard API token.');
    }
    Object.defineProperty(this, '_token', { value: t, enumerable: false, writable: false });

    if (fetchImpl !== null && typeof fetchImpl !== 'function') {
      throw new JokelboardConfigurationError('fetchImpl must be a function.');
    }
    Object.defineProperty(this, '_fetch', {
      value: fetchImpl ?? globalThis.fetch,
      enumerable: false,
      writable: false,
    });

    if (!this._fetch) {
      throw new JokelboardConfigurationError('No fetch() available. Pass fetchImpl or use Node 18+.');
    }

    this._baseUrl = normaliseBaseUrl(baseUrl);
    this._timeout = Number.isFinite(timeout) ? Math.max(1, timeout) : DEFAULT_TIMEOUT;
    this._retryOnRateLimit = retryOnRateLimit !== false;
    this._maxRetries = Number.isInteger(maxRetries) ? Math.max(0, maxRetries) : DEFAULT_MAX_RETRIES;
    this._maxConflictRetries = Number.isInteger(maxConflictRetries) ? Math.max(0, maxConflictRetries) : DEFAULT_MAX_CONFLICT_RETRIES;
    this.defaultBoardId = defaultBoardId ? requireId(defaultBoardId, 'defaultBoardId') : null;

    // Per-board write queues — serialises revision-aware writes per board
    this._writeTails = new Map();
    const pluginImpl = new PluginClient(this._request.bind(this));

    // Namespaced frozen API groups
    this.plugin = Object.freeze({
      getAccessLevel: () => pluginImpl.getAccessLevel(),
      getBoard: (boardId) => pluginImpl.getBoard(boardId),
      toggleChecklistItem: (boardId, cardId, itemId) => pluginImpl.toggleChecklistItem(boardId, cardId, itemId),
    });

    this.boards = Object.freeze({
      list: () => this.listBoards(),
      get: (boardId) => this.getBoard(boardId),
      replace: (boardId, data, revision) => this.replaceBoard(boardId, data, revision),
    });

    this.lists = Object.freeze({
      create: (boardId, title) => this.createList(boardId, title),
    });

    this.cards = Object.freeze({
      create: (boardId, listId, title, options) => this.createCard(boardId, listId, title, options),
      update: (boardId, cardId, fields) => this.updateCard(boardId, cardId, fields),
      patch: (boardId, cardId, patchOrFn) => this.patchCard(boardId, cardId, patchOrFn),
      comment: (boardId, cardId, text, options) => this.addComment(boardId, cardId, text, options),
      move: (boardId, cardId, toListId, options) => this.moveCard(boardId, cardId, toListId, options),
      link: (boardId, cardId) => this.getCardLink(boardId, cardId),
      vault: (boardId, cardId) => this.vaultCard(boardId, cardId),
      restore: (boardId, cardId, options) => this.restoreCard(boardId, cardId, options),
      find: (boardId, predicate) => this.findCard(boardId, predicate),
    });

    this.vault = Object.freeze({
      list: (boardId) => this.getVault(boardId),
      purge: (boardId, cardId, revision) => this.purgeCard(boardId, cardId, revision),
    });
  }

  // ---- Core HTTP ----

  /**
   * @param {string} method
   * @param {string} path
   * @param {unknown} [body]
   * @param {number} [attempt]
   * @returns {Promise<any>}
   */
  async _request(method, path, body, attempt = 0) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._timeout);
    const hasBody = body !== undefined;
    const ctx = { method, path };

    let res;
    try {
      res = await this._fetch(`${this._baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this._token}`,
          ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        },
        body: hasBody ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err?.name === 'AbortError') {
        throw new JokelboardError('request_timeout', 'Request timed out.', null, null, ctx);
      }
      throw new JokelboardError('network_error', 'Unable to reach the Jokelboard API.', null, null, ctx);
    }
    clearTimeout(timer);

    const raw = await res.text();
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch { /* non-JSON body */ }
    }
    const redacted = this._redact(data);

    if (res.ok) return data;

    if (res.status === 429) {
      const retryAfter = data?.retryAfter ?? (Number(res.headers.get('retry-after')) || 1);
      if (this._retryOnRateLimit && attempt < this._maxRetries) {
        await sleep(retryAfter * 1000);
        return this._request(method, path, body, attempt + 1);
      }
      throw new RateLimitError(data?.message ?? 'Rate limit exceeded.', retryAfter, redacted, ctx);
    }

    if (res.status === 409 && data?.error === 'revision_conflict') {
      throw new RevisionConflictError(
        data?.message ?? 'Revision conflict.',
        data?.currentRevision ?? null,
        redacted,
        ctx,
      );
    }

    throw new JokelboardError(
      data?.error ?? 'http_error',
      data?.message ?? `HTTP ${res.status}`,
      res.status,
      redacted,
      ctx,
    );
  }

  /**
   * Strips the API token from any value recursively so it never appears in error objects.
   * @param {unknown} value
   * @returns {unknown}
   */
  _redact(value) {
    return redactToken(value, this._token);
  }

  // ---- Revision-safe write queue ----

  /**
   * Internal: enqueues a write on a per-board queue and retries on revision conflicts.
   * @param {string} boardId
   * @param {(board: object, revision: number) => Promise<any>} operation
   * @returns {Promise<any>}
   */
  _withRevision(boardId, operation) {
    if (!this._writeTails.has(boardId)) {
      this._writeTails.set(boardId, Promise.resolve());
    }

    const result = this._writeTails.get(boardId).then(async () => {
      for (let attempt = 0; attempt <= this._maxConflictRetries; attempt++) {
        const board = await this.getBoard(boardId);
        if (board.revision == null) {
          throw new JokelboardError('invalid_response', 'Board response missing revision.', null, board);
        }
        try {
          return await operation(board, board.revision);
        } catch (err) {
          if (err instanceof RevisionConflictError && attempt < this._maxConflictRetries) continue;
          throw err;
        }
      }
    });

    this._writeTails.set(boardId, result.catch(() => {}));
    return result;
  }

  /**
   * Public revision helper. Fetches the current board revision then calls operation({ revision, board, boardClient, attempt }).
   * Retries automatically on revision conflicts.
   * @param {string} boardId
   * @param {(ctx: { revision: number, board: object, boardClient: BoardClient, attempt: number }) => Promise<any>} operation
   * @param {{ retries?: number }} [options]
   * @returns {Promise<any>}
   */
  withFreshRevision(boardId, operation, { retries = this._maxConflictRetries } = {}) {
    if (typeof operation !== 'function') {
      throw new JokelboardConfigurationError('operation must be a function.');
    }
    const resolvedId = this.resolveBoardId(boardId);
    const boardClient = this.board(resolvedId);
    return this._withRevision(resolvedId, (board, revision) =>
      operation({ revision, board, boardClient, attempt: 1 }),
    );
  }

  /**
   * Resolves a boardId, falling back to defaultBoardId.
   * @param {string|null|undefined} boardId
   * @returns {string}
   */
  resolveBoardId(boardId) {
    const resolved = boardId ?? this.defaultBoardId;
    if (resolved == null) {
      throw new JokelboardConfigurationError(
        'boardId is required. Pass one directly or set defaultBoardId on the client.',
      );
    }
    return requireId(resolved, 'boardId');
  }

  /**
   * Returns a board-scoped proxy so you never need to pass boardId per call.
   * @param {string} [boardId] - Defaults to defaultBoardId
   * @returns {BoardClient}
   */
  board(boardId) {
    return new BoardClient(this, this.resolveBoardId(boardId));
  }

  // ---- Me ----

  /** @returns {Promise<{user: object, token: object}>} */
  async getMe() {
    const d = await this._request('GET', '/me');
    if (!d?.user || !d?.token) {
      throw new JokelboardError('invalid_response', 'Invalid identity response.', null, d);
    }
    return d;
  }

  // ---- Boards ----

  /** @returns {Promise<object[]>} */
  async listBoards() {
    const d = await this._request('GET', '/boards');
    if (!Array.isArray(d?.boards)) {
      throw new JokelboardError('invalid_response', 'Invalid board list response.', null, d);
    }
    return d.boards;
  }

  /**
   * @param {string} [boardId] - Defaults to defaultBoardId
   * @returns {Promise<object>}
   */
  async getBoard(boardId) {
    const id = this.resolveBoardId(boardId);
    const d = await this._request('GET', `/boards/${encodeId(id, 'boardId')}`);
    if (!d?.board?.data || !Array.isArray(d.board.data.lists)) {
      throw new JokelboardError('invalid_response', 'Invalid board response.', null, d);
    }
    return d.board;
  }

  /**
   * Returns all lists on a board.
   * @param {string} [boardId]
   * @returns {Promise<object[]>}
   */
  async getLists(boardId) {
    const board = await this.getBoard(boardId);
    return board.data.lists;
  }

  /**
   * Finds a card on a board by searching through all lists.
   * @param {string} boardId
   * @param {(card: object, list: object) => boolean} predicate
   * @returns {Promise<{card: object, list: object} | null>}
   */
  async findCard(boardId, predicate) {
    const board = await this.getBoard(boardId);
    return findCard(board, predicate);
  }

  /**
   * Fetches a single card by ID. Throws if not found.
   * @param {string} boardId
   * @param {string} cardId
   * @returns {Promise<object>}
   */
  async getCard(boardId, cardId) {
    const cleanCardId = requireId(cardId, 'cardId');
    const board = await this.getBoard(boardId);
    const match = findCard(board, c => c.id === cleanCardId);
    if (!match) {
      throw new JokelboardError('card_not_found', `Card "${cleanCardId}" not found on board.`, 404, null);
    }
    return match.card;
  }

  /**
   * Finds a card by exact title (case-insensitive). Returns null if not found.
   * @param {string} boardId
   * @param {string} title
   * @returns {Promise<{card: object, list: object} | null>}
   */
  async findCardByTitle(boardId, title) {
    const target = requireId(title, 'title').toLowerCase();
    const board = await this.getBoard(boardId);
    return findCard(board, c => typeof c.title === 'string' && c.title.trim().toLowerCase() === target);
  }

  /**
   * Finds a card by ID. Returns null if not found.
   * @param {string} boardId
   * @param {string} cardId
   * @returns {Promise<{card: object, list: object} | null>}
   */
  async findCardById(boardId, cardId) {
    const target = requireId(cardId, 'cardId');
    const board = await this.getBoard(boardId);
    return findCard(board, c => c.id === target);
  }

  /**
   * @param {string} boardId
   * @param {object} boardData
   * @param {number} [revision]
   * @returns {Promise<object>}
   */
  async replaceBoard(boardId, boardData, revision) {
    const id = this.resolveBoardId(boardId);
    const d = await this._request('PUT', `/boards/${encodeId(id, 'boardId')}`, {
      data: boardData,
      ...(revision !== undefined && { revision }),
    });
    return d.board;
  }

  // ---- Lists ----

  /**
   * @param {string} boardId
   * @param {string} title
   * @returns {Promise<object>}
   */
  async createList(boardId, title) {
    const id = this.resolveBoardId(boardId);
    const cleanTitle = requireId(title, 'title');
    return this._withRevision(id, (_, revision) =>
      this._request('POST', `/boards/${encodeId(id, 'boardId')}/lists`, { title: cleanTitle, revision }),
    );
  }

  // ---- Cards ----

  /**
   * @param {string} boardId
   * @param {string} listId
   * @param {string} title
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async createCard(boardId, listId, title, options) {
    const id = this.resolveBoardId(boardId);
    const cleanTitle = requireId(title, 'title');
    const cleanListId = requireId(listId, 'listId');
    return this._withRevision(id, (board, revision) => {
      if (!board.data.lists.some(l => l.id === cleanListId)) {
        throw new JokelboardConfigurationError(`List "${cleanListId}" does not exist on this board.`);
      }
      return this._request('POST', `/boards/${encodeId(id, 'boardId')}/cards`, {
        listId: cleanListId,
        title: cleanTitle,
        ...options,
        revision,
      });
    });
  }

  /**
   * Simple PATCH — caller supplies revision if needed.
   * For automatic revision handling use patchCard() instead.
   * @param {string} boardId
   * @param {string} cardId
   * @param {object} fields
   * @returns {Promise<object>}
   */
  async updateCard(boardId, cardId, fields) {
    const id = this.resolveBoardId(boardId);
    const d = await this._request(
      'PATCH',
      `/boards/${encodeId(id, 'boardId')}/cards/${encodeId(cardId, 'cardId')}`,
      fields,
    );
    return d.card;
  }

  /**
   * Revision-safe PATCH with write queue. The patch may be a plain object or
   * a function (card, list, board) => object that receives the current card state.
   * @param {string} boardId
   * @param {string} cardId
   * @param {object | ((card: object, list: object, board: object) => object | Promise<object>)} patchOrFn
   * @returns {Promise<object>}
   */
  async patchCard(boardId, cardId, patchOrFn) {
    const id = this.resolveBoardId(boardId);
    const cleanCardId = requireId(cardId, 'cardId');
    return this._withRevision(id, async (board, revision) => {
      let patch = patchOrFn;
      if (typeof patchOrFn === 'function') {
        const match = findCard(board, c => c.id === cleanCardId);
        if (!match) {
          throw new JokelboardError('card_not_found', `Card "${cleanCardId}" not found on board.`, 404, null);
        }
        patch = await patchOrFn(match.card, match.list, board);
      }
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new JokelboardConfigurationError('Card patch must resolve to a plain object.');
      }
      const d = await this._request(
        'PATCH',
        `/boards/${encodeId(id, 'boardId')}/cards/${encodeId(cleanCardId, 'cardId')}`,
        { ...patch, revision },
      );
      return d.card;
    });
  }

  // ---- Custom fields ----

  /**
   * Returns all custom field values for a card.
   * @param {string} boardId
   * @param {string} cardId
   * @returns {Promise<Record<string, string>>}
   */
  async getCustomFields(boardId, cardId) {
    const cleanCardId = requireId(cardId, 'cardId');
    const board = await this.getBoard(boardId);
    const match = findCard(board, c => c.id === cleanCardId);
    if (!match) {
      throw new JokelboardError('card_not_found', `Card "${cleanCardId}" not found on board.`, 404, null);
    }
    return match.card.fieldValues ?? {};
  }

  /**
   * Returns the value of a single custom field, or null if not set.
   * @param {string} boardId
   * @param {string} cardId
   * @param {string} fieldKey
   * @returns {Promise<string | null>}
   */
  async getCustomField(boardId, cardId, fieldKey) {
    requireId(fieldKey, 'fieldKey');
    const fields = await this.getCustomFields(boardId, cardId);
    return fields[fieldKey] ?? null;
  }

  /**
   * Sets a single custom field, preserving all other existing field values.
   * @param {string} boardId
   * @param {string} cardId
   * @param {string} fieldKey
   * @param {string | number} value
   * @returns {Promise<object>}
   */
  setCustomField(boardId, cardId, fieldKey, value) {
    requireId(fieldKey, 'fieldKey');
    return this.patchCard(boardId, cardId, card => ({
      fieldValues: { ...(card.fieldValues ?? {}), [fieldKey]: String(value) },
    }));
  }

  /**
   * Merges multiple custom field values, preserving all existing fields not in the update.
   * @param {string} boardId
   * @param {string} cardId
   * @param {Record<string, string | number>} fields
   * @returns {Promise<object>}
   */
  setCustomFields(boardId, cardId, fields) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      throw new JokelboardConfigurationError('fields must be a plain object.');
    }
    const normalised = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)]));
    return this.patchCard(boardId, cardId, card => ({
      fieldValues: { ...(card.fieldValues ?? {}), ...normalised },
    }));
  }

  // ---- Move / link / comment ----

  /**
   * @param {string} boardId
   * @param {string} cardId
   * @param {string} toListId
   * @param {{position?: number}} [options]
   * @returns {Promise<void>}
   */
  async moveCard(boardId, cardId, toListId, options = {}) {
    const id = this.resolveBoardId(boardId);
    const cleanToListId = requireId(toListId, 'toListId');
    return this._withRevision(id, (board, revision) => {
      if (!board.data.lists.some(l => l.id === cleanToListId)) {
        throw new JokelboardConfigurationError(`Destination list "${cleanToListId}" does not exist on this board.`);
      }
      return this._request(
        'POST',
        `/boards/${encodeId(id, 'boardId')}/cards/${encodeId(cardId, 'cardId')}/move`,
        {
          toListId: cleanToListId,
          ...(Number.isInteger(options.position) ? { position: options.position } : {}),
          revision,
        },
      );
    });
  }

  /**
   * @param {string} boardId
   * @param {string} cardId
   * @returns {Promise<string>}
   */
  async getCardLink(boardId, cardId) {
    const id = this.resolveBoardId(boardId);
    const d = await this._request(
      'GET',
      `/boards/${encodeId(id, 'boardId')}/cards/${encodeId(cardId, 'cardId')}/link`,
    );
    if (typeof d?.url !== 'string' || !d.url) {
      throw new JokelboardError('invalid_response', 'Invalid card link response.', null, d);
    }
    return d.url;
  }

  /**
   * @param {string} boardId
   * @param {string} cardId
   * @param {string} text
   * @param {{kind?: string}} [options]
   * @returns {Promise<void>}
   */
  async addComment(boardId, cardId, text, options = {}) {
    const id = this.resolveBoardId(boardId);
    const cleanText = sanitiseComment(requireId(text, 'text'));
    return this._withRevision(id, (_, revision) =>
      this._request(
        'POST',
        `/boards/${encodeId(id, 'boardId')}/cards/${encodeId(cardId, 'cardId')}/comments`,
        { text: cleanText, ...(options.kind ? { kind: options.kind } : {}), revision },
      ),
    );
  }

  // ---- Vault ----

  /**
   * @param {string} boardId
   * @returns {Promise<object[]>}
   */
  async getVault(boardId) {
    const id = this.resolveBoardId(boardId);
    const d = await this._request('GET', `/boards/${encodeId(id, 'boardId')}/vault`);
    return d.vault;
  }

  /**
   * @param {string} boardId
   * @param {string} cardId
   * @returns {Promise<void>}
   */
  vaultCard(boardId, cardId) {
    const id = this.resolveBoardId(boardId);
    return this._withRevision(id, (_, revision) =>
      this._request(
        'POST',
        `/boards/${encodeId(id, 'boardId')}/cards/${encodeId(cardId, 'cardId')}/vault`,
        { revision },
      ),
    );
  }

  /**
   * @param {string} boardId
   * @param {string} cardId
   * @param {{toListId?: string, position?: number}} [options]
   * @returns {Promise<void>}
   */
  restoreCard(boardId, cardId, options = {}) {
    const id = this.resolveBoardId(boardId);
    return this._withRevision(id, (_, revision) =>
      this._request(
        'POST',
        `/boards/${encodeId(id, 'boardId')}/cards/${encodeId(cardId, 'cardId')}/restore`,
        { ...options, revision },
      ),
    );
  }

  /**
   * @param {string} boardId
   * @param {string} cardId
   * @param {number} [revision]
   * @returns {Promise<void>}
   */
  purgeCard(boardId, cardId, revision) {
    const id = this.resolveBoardId(boardId);
    const path = `/boards/${encodeId(id, 'boardId')}/vault/${encodeId(cardId, 'cardId')}`;
    return this._request('DELETE', revision !== undefined ? `${path}?revision=${revision}` : path);
  }

  // ---- Board tokens ----

  /** @param {string} boardId @returns {Promise<object[]>} */
  async listBoardTokens(boardId) {
    const id = this.resolveBoardId(boardId);
    return (await this._request('GET', `/boards/${encodeId(id, 'boardId')}/tokens`)).tokens;
  }

  /** @param {string} boardId @param {string} name @param {string} type @returns {Promise<object>} */
  async createBoardToken(boardId, name, type) {
    const id = this.resolveBoardId(boardId);
    return (await this._request('POST', `/boards/${encodeId(id, 'boardId')}/tokens`, { name, type })).token;
  }

  /** @param {string} boardId @param {string} tokenId @returns {Promise<void>} */
  deleteBoardToken(boardId, tokenId) {
    const id = this.resolveBoardId(boardId);
    return this._request('DELETE', `/boards/${encodeId(id, 'boardId')}/tokens/${encodeId(tokenId, 'tokenId')}`);
  }

  // ---- Profile tokens ----

  /** @returns {Promise<object[]>} */
  async listProfileTokens() {
    return (await this._request('GET', '/me/tokens')).tokens;
  }

  /** @param {string} name @returns {Promise<object>} */
  async createProfileToken(name) {
    return (await this._request('POST', '/me/tokens', { name, type: 'programmatic' })).token;
  }

  /** @param {string} tokenId @returns {Promise<void>} */
  deleteProfileToken(tokenId) {
    return this._request('DELETE', `/me/tokens/${encodeId(tokenId, 'tokenId')}`);
  }

  // ---- Org tokens ----

  /** @param {string} orgId @returns {Promise<object[]>} */
  async listOrgTokens(orgId) {
    return (await this._request('GET', `/organisations/${encodeId(orgId, 'orgId')}/tokens`)).tokens;
  }

  /** @param {string} orgId @param {string} name @returns {Promise<object>} */
  async createOrgToken(orgId, name) {
    return (await this._request('POST', `/organisations/${encodeId(orgId, 'orgId')}/tokens`, { name })).token;
  }

  /** @param {string} orgId @param {string} tokenId @returns {Promise<void>} */
  deleteOrgToken(orgId, tokenId) {
    return this._request('DELETE', `/organisations/${encodeId(orgId, 'orgId')}/tokens/${encodeId(tokenId, 'tokenId')}`);
  }

  /**
   * @param {string} orgId
   * @param {string} tokenId
   * @param {{name?: string|null, avatar?: string|null}} config
   * @returns {Promise<object>}
   */
  async configureOrgBotToken(orgId, tokenId, config) {
    return (await this._request(
      'PATCH',
      `/organisations/${encodeId(orgId, 'orgId')}/tokens/${encodeId(tokenId, 'tokenId')}/bot`,
      config,
    )).token;
  }
}

// ---- Plugin client ----

class PluginClient {
  /** @param {Function} request */
  constructor(request) { this._request = request; }

  /** @param {string} boardId @returns {Promise<object>} */
  async getBoard(boardId) {
    return (await this._request('GET', `/plugin/boards/${encodeId(boardId, 'boardId')}`)).board;
  }

  /** @param {string} boardId @param {string} cardId @param {string} itemId @returns {Promise<object>} */
  async toggleChecklistItem(boardId, cardId, itemId) {
    return (await this._request(
      'POST',
      `/plugin/boards/${encodeId(boardId, 'boardId')}/cards/${encodeId(cardId, 'cardId')}/checklist-items/${encodeId(itemId, 'itemId')}/toggle`,
    )).item;
  }

  /** @returns {Promise<unknown>} */
  getAccessLevel() { return this._request('GET', '/plugin/access-level'); }
}
