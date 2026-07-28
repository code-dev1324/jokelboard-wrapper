import { JokelboardError, JokelboardConfigurationError, RateLimitError, RevisionConflictError } from './errors.js';

const DEFAULT_BASE_URL = 'https://api.jokelboard.com/api/v1';
const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_CONFLICT_RETRIES = 1;

// ---- Helpers ----

/**
 * Normalises and validates the base URL. Enforces HTTPS (except localhost),
 * strips trailing slashes, and rejects embedded credentials.
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

  const local = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local.has(url.hostname))) {
    throw new JokelboardConfigurationError('baseUrl must use HTTPS.');
  }

  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

/**
 * Asserts that a value is a non-empty string and returns it trimmed.
 * @param {unknown} value
 * @param {string} name
 * @returns {string}
 */
function requireId(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new JokelboardConfigurationError(`${name} must be a non-empty string.`);
  }
  return value.trim();
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

/** @param {number} ms @returns {Promise<void>} */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- Client ----

export class JokelboardClient {
  /**
   * @param {object} options
   * @param {string} options.token - Jokelboard API token (jkb_...)
   * @param {string} [options.baseUrl] - Override API base URL
   * @param {number} [options.timeout] - Request timeout in ms (default: 10000)
   * @param {boolean} [options.retryOnRateLimit] - Auto-retry on 429 (default: true)
   * @param {number} [options.maxRetries] - Max 429 retry attempts (default: 3)
   * @param {number} [options.maxConflictRetries] - Max revision-conflict retries (default: 1)
   */
  constructor({
    token,
    baseUrl = DEFAULT_BASE_URL,
    timeout = DEFAULT_TIMEOUT,
    retryOnRateLimit = true,
    maxRetries = DEFAULT_MAX_RETRIES,
    maxConflictRetries = DEFAULT_MAX_CONFLICT_RETRIES,
  }) {
    const t = requireId(token, 'token');
    if (!t.startsWith('jkb_') || t.length > 256 || /\s/.test(t)) {
      throw new JokelboardConfigurationError('token is not a valid Jokelboard API token.');
    }
    // Non-enumerable so it doesn't show up in console.log / JSON.stringify
    Object.defineProperty(this, '_token', { value: t, enumerable: false, writable: false });

    this._baseUrl = normaliseBaseUrl(baseUrl);
    this._timeout = Number.isFinite(timeout) ? Math.max(1, timeout) : DEFAULT_TIMEOUT;
    this._retryOnRateLimit = retryOnRateLimit !== false;
    this._maxRetries = Number.isInteger(maxRetries) ? Math.max(0, maxRetries) : DEFAULT_MAX_RETRIES;
    this._maxConflictRetries = Number.isInteger(maxConflictRetries) ? Math.max(0, maxConflictRetries) : DEFAULT_MAX_CONFLICT_RETRIES;

    // Per-board write queues — ensures revision-aware writes are serialised per board
    this._writeTails = new Map();

    this.plugin = new PluginClient(this._request.bind(this));
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

    let res;
    try {
      res = await fetch(`${this._baseUrl}${path}`, {
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
        throw new JokelboardError('request_timeout', 'Request timed out.', 0, null);
      }
      throw new JokelboardError('network_error', 'Unable to reach the Jokelboard API.', 0, null);
    }
    clearTimeout(timer);

    const raw = await res.text();
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch { /* non-JSON body */ }
    }

    if (res.ok) return data;

    if (res.status === 429) {
      const retryAfter = data?.retryAfter ?? Number(res.headers.get('retry-after')) || 1;
      if (this._retryOnRateLimit && attempt < this._maxRetries) {
        await sleep(retryAfter * 1000);
        return this._request(method, path, body, attempt + 1);
      }
      throw new RateLimitError(data?.message ?? 'Rate limit exceeded.', retryAfter, data);
    }

    if (res.status === 409 && data?.error === 'revision_conflict') {
      throw new RevisionConflictError(
        data?.message ?? 'Revision conflict.',
        data?.currentRevision ?? null,
        data,
      );
    }

    throw new JokelboardError(
      data?.error ?? 'http_error',
      data?.message ?? `HTTP ${res.status}`,
      res.status,
      data,
    );
  }

  // ---- Revision-safe write queue ----

  /**
   * Enqueues a write on a per-board queue and retries automatically on
   * revision conflicts, re-fetching the board before each retry.
   *
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
          throw new JokelboardError('invalid_response', 'Board response missing revision.', 0, board);
        }
        try {
          return await operation(board, board.revision);
        } catch (err) {
          if (err instanceof RevisionConflictError && attempt < this._maxConflictRetries) continue;
          throw err;
        }
      }
    });

    // Keep the tail alive even if the current operation rejects
    this._writeTails.set(boardId, result.catch(() => {}));
    return result;
  }

  // ---- Me ----

  /** @returns {Promise<{user: object, token: object}>} */
  async getMe() {
    const d = await this._request('GET', '/me');
    if (!d?.user || !d?.token) {
      throw new JokelboardError('invalid_response', 'Invalid identity response from Jokelboard.', 0, d);
    }
    return d;
  }

  // ---- Boards ----

  /** @returns {Promise<object[]>} */
  async listBoards() {
    const d = await this._request('GET', '/boards');
    if (!Array.isArray(d?.boards)) {
      throw new JokelboardError('invalid_response', 'Invalid board list response.', 0, d);
    }
    return d.boards;
  }

  /**
   * @param {string} boardId
   * @returns {Promise<object>}
   */
  async getBoard(boardId) {
    const d = await this._request('GET', `/boards/${encodeId(boardId, 'boardId')}`);
    if (!d?.board?.data || !Array.isArray(d.board.data.lists)) {
      throw new JokelboardError('invalid_response', 'Invalid board response.', 0, d);
    }
    return d.board;
  }

  /**
   * Finds a card on a board by searching through all lists.
   * @param {string} boardId
   * @param {(card: object, list: object) => boolean} predicate
   * @param {boolean} [refresh] - Force a fresh board fetch (default: true)
   * @returns {Promise<{card: object, list: object} | null>}
   */
  async findCard(boardId, predicate, refresh = true) {
    const board = await this.getBoard(boardId);
    return findCard(board, predicate);
  }

  /**
   * @param {string} boardId
   * @param {object} boardData
   * @param {number} [revision]
   * @returns {Promise<object>}
   */
  async replaceBoard(boardId, boardData, revision) {
    const d = await this._request('PUT', `/boards/${encodeId(boardId, 'boardId')}`, {
      data: boardData,
      ...(revision !== undefined && { revision }),
    });
    return d.board;
  }

  // ---- Lists ----

  /**
   * @param {string} boardId
   * @param {string} title
   * @param {{id?: string}} [options]
   * @returns {Promise<object>}
   */
  async createList(boardId, title) {
    const cleanTitle = requireId(title, 'title');
    return this._withRevision(boardId, (_, revision) =>
      this._request('POST', `/boards/${encodeId(boardId, 'boardId')}/lists`, { title: cleanTitle, revision }),
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
    const cleanTitle = requireId(title, 'title');
    const cleanListId = requireId(listId, 'listId');
    return this._withRevision(boardId, (board, revision) => {
      const listExists = board.data.lists.some(l => l.id === cleanListId);
      if (!listExists) {
        throw new JokelboardConfigurationError(`List "${cleanListId}" does not exist on this board.`);
      }
      return this._request('POST', `/boards/${encodeId(boardId, 'boardId')}/cards`, {
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
    const d = await this._request(
      'PATCH',
      `/boards/${encodeId(boardId, 'boardId')}/cards/${encodeId(cardId, 'cardId')}`,
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
    const cleanCardId = requireId(cardId, 'cardId');
    return this._withRevision(boardId, async (board, revision) => {
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
        `/boards/${encodeId(boardId, 'boardId')}/cards/${encodeId(cleanCardId, 'cardId')}`,
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
    const normalised = Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, String(v)]),
    );
    return this.patchCard(boardId, cardId, card => ({
      fieldValues: { ...(card.fieldValues ?? {}), ...normalised },
    }));
  }

  /**
   * @param {string} boardId
   * @param {string} cardId
   * @param {string} toListId
   * @param {{position?: number}} [options]
   * @returns {Promise<void>}
   */
  async moveCard(boardId, cardId, toListId, options = {}) {
    const cleanToListId = requireId(toListId, 'toListId');
    return this._withRevision(boardId, (board, revision) => {
      const listExists = board.data.lists.some(l => l.id === cleanToListId);
      if (!listExists) {
        throw new JokelboardConfigurationError(`Destination list "${cleanToListId}" does not exist on this board.`);
      }
      return this._request(
        'POST',
        `/boards/${encodeId(boardId, 'boardId')}/cards/${encodeId(cardId, 'cardId')}/move`,
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
    const d = await this._request(
      'GET',
      `/boards/${encodeId(boardId, 'boardId')}/cards/${encodeId(cardId, 'cardId')}/link`,
    );
    if (typeof d?.url !== 'string' || !d.url) {
      throw new JokelboardError('invalid_response', 'Invalid card link response.', 0, d);
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
    const cleanText = sanitiseComment(requireId(text, 'text'));
    return this._withRevision(boardId, (_, revision) =>
      this._request(
        'POST',
        `/boards/${encodeId(boardId, 'boardId')}/cards/${encodeId(cardId, 'cardId')}/comments`,
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
    const d = await this._request('GET', `/boards/${encodeId(boardId, 'boardId')}/vault`);
    return d.vault;
  }

  /**
   * @param {string} boardId
   * @param {string} cardId
   * @param {number} [revision]
   * @returns {Promise<void>}
   */
  vaultCard(boardId, cardId, revision) {
    return this._request(
      'POST',
      `/boards/${encodeId(boardId, 'boardId')}/cards/${encodeId(cardId, 'cardId')}/vault`,
      revision !== undefined ? { revision } : undefined,
    );
  }

  /**
   * @param {string} boardId
   * @param {string} cardId
   * @param {{toListId?: string, position?: number, revision?: number}} [options]
   * @returns {Promise<void>}
   */
  restoreCard(boardId, cardId, options) {
    return this._request(
      'POST',
      `/boards/${encodeId(boardId, 'boardId')}/cards/${encodeId(cardId, 'cardId')}/restore`,
      options,
    );
  }

  /**
   * @param {string} boardId
   * @param {string} cardId
   * @param {number} [revision]
   * @returns {Promise<void>}
   */
  purgeCard(boardId, cardId, revision) {
    const path = `/boards/${encodeId(boardId, 'boardId')}/vault/${encodeId(cardId, 'cardId')}`;
    return this._request('DELETE', revision !== undefined ? `${path}?revision=${revision}` : path);
  }

  // ---- Board tokens ----

  /** @param {string} boardId @returns {Promise<object[]>} */
  async listBoardTokens(boardId) {
    return (await this._request('GET', `/boards/${encodeId(boardId, 'boardId')}/tokens`)).tokens;
  }

  /** @param {string} boardId @param {string} name @param {string} type @returns {Promise<object>} */
  async createBoardToken(boardId, name, type) {
    return (await this._request('POST', `/boards/${encodeId(boardId, 'boardId')}/tokens`, { name, type })).token;
  }

  /** @param {string} boardId @param {string} tokenId @returns {Promise<void>} */
  deleteBoardToken(boardId, tokenId) {
    return this._request('DELETE', `/boards/${encodeId(boardId, 'boardId')}/tokens/${encodeId(tokenId, 'tokenId')}`);
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
    return (await this._request('PATCH', `/organisations/${encodeId(orgId, 'orgId')}/tokens/${encodeId(tokenId, 'tokenId')}/bot`, config)).token;
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
