import { JokelboardError, RateLimitError, RevisionConflictError } from './errors.js';

const DEFAULT_BASE_URL = 'https://api.jokelboard.com/api/v1';
const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_MAX_RETRIES = 3;

export class JokelboardClient {
  /**
   * @param {object} options
   * @param {string} options.token - Jokelboard API token (jkb_...)
   * @param {string} [options.baseUrl] - Override API base URL
   * @param {number} [options.timeout] - Request timeout in ms (default: 10000)
   * @param {boolean} [options.retryOnRateLimit] - Auto-retry on 429 (default: true)
   * @param {number} [options.maxRetries] - Max retry attempts (default: 3)
   */
  constructor({ token, baseUrl = DEFAULT_BASE_URL, timeout = DEFAULT_TIMEOUT, retryOnRateLimit = true, maxRetries = DEFAULT_MAX_RETRIES }) {
    this._token = token;
    this._baseUrl = baseUrl.replace(/\/$/, '');
    this._timeout = timeout;
    this._retryOnRateLimit = retryOnRateLimit;
    this._maxRetries = maxRetries;
    this.plugin = new PluginClient(this._request.bind(this));
  }

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

    let res;
    try {
      res = await fetch(`${this._baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this._token}`,
          'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const data = await res.json().catch(() => null);

    if (res.ok) return data;

    if (res.status === 429 && this._retryOnRateLimit && attempt < this._maxRetries) {
      const retryAfter = data?.retryAfter ?? 1;
      await sleep(retryAfter * 1000);
      return this._request(method, path, body, attempt + 1);
    }

    if (res.status === 429) {
      throw new RateLimitError(data?.message ?? 'Rate limit exceeded', data?.retryAfter ?? 1, data?.limit ?? 10, data?.windowMs ?? 5000, data);
    }

    if (res.status === 409 && data?.error === 'revision_conflict') {
      throw new RevisionConflictError(data?.message ?? 'Revision conflict', data?.currentRevision ?? 0, data);
    }

    throw new JokelboardError(data?.error ?? 'unknown_error', data?.message ?? `HTTP ${res.status}`, res.status, data);
  }

  // ---- Me ----

  /** @returns {Promise<{user: object, token: object}>} */
  getMe() { return this._request('GET', '/me'); }

  // ---- Boards ----

  /** @returns {Promise<object[]>} */
  async listBoards() {
    const d = await this._request('GET', '/boards');
    return d.boards;
  }

  /**
   * @param {string} boardId
   * @returns {Promise<object>}
   */
  async getBoard(boardId) {
    const d = await this._request('GET', `/boards/${boardId}`);
    return d.board;
  }

  /**
   * @param {string} boardId
   * @param {object} boardData
   * @param {number} [revision]
   * @returns {Promise<object>}
   */
  async replaceBoard(boardId, boardData, revision) {
    const d = await this._request('PUT', `/boards/${boardId}`, { data: boardData, ...(revision !== undefined && { revision }) });
    return d.board;
  }

  // ---- Lists ----

  /**
   * @param {string} boardId
   * @param {string} title
   * @param {{id?: string, revision?: number}} [options]
   * @returns {Promise<object>}
   */
  async createList(boardId, title, options) {
    const d = await this._request('POST', `/boards/${boardId}/lists`, { title, ...options });
    return d.list;
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
    const d = await this._request('POST', `/boards/${boardId}/cards`, { listId, title, ...options });
    return d.card;
  }

  /**
   * @param {string} boardId
   * @param {string} cardId
   * @param {object} fields
   * @returns {Promise<object>}
   */
  async updateCard(boardId, cardId, fields) {
    const d = await this._request('PATCH', `/boards/${boardId}/cards/${cardId}`, fields);
    return d.card;
  }

  /**
   * @param {string} boardId
   * @param {string} cardId
   * @param {string} toListId
   * @param {{position?: number, revision?: number}} [options]
   * @returns {Promise<void>}
   */
  moveCard(boardId, cardId, toListId, options) {
    return this._request('POST', `/boards/${boardId}/cards/${cardId}/move`, { toListId, ...options });
  }

  /**
   * @param {string} boardId
   * @param {string} cardId
   * @returns {Promise<object>}
   */
  getCardLink(boardId, cardId) {
    return this._request('GET', `/boards/${boardId}/cards/${cardId}/link`);
  }

  /**
   * @param {string} boardId
   * @param {string} cardId
   * @param {string} text
   * @param {{kind?: string, revision?: number}} [options]
   * @returns {Promise<void>}
   */
  addComment(boardId, cardId, text, options) {
    return this._request('POST', `/boards/${boardId}/cards/${cardId}/comments`, { text, ...options });
  }

  // ---- Vault ----

  /**
   * @param {string} boardId
   * @returns {Promise<object[]>}
   */
  async getVault(boardId) {
    const d = await this._request('GET', `/boards/${boardId}/vault`);
    return d.vault;
  }

  /**
   * @param {string} boardId
   * @param {string} cardId
   * @param {number} [revision]
   * @returns {Promise<void>}
   */
  vaultCard(boardId, cardId, revision) {
    return this._request('POST', `/boards/${boardId}/cards/${cardId}/vault`, revision !== undefined ? { revision } : undefined);
  }

  /**
   * @param {string} boardId
   * @param {string} cardId
   * @param {{toListId?: string, position?: number, revision?: number}} [options]
   * @returns {Promise<void>}
   */
  restoreCard(boardId, cardId, options) {
    return this._request('POST', `/boards/${boardId}/cards/${cardId}/restore`, options);
  }

  /**
   * @param {string} boardId
   * @param {string} cardId
   * @param {number} [revision]
   * @returns {Promise<void>}
   */
  purgeCard(boardId, cardId, revision) {
    const path = revision !== undefined
      ? `/boards/${boardId}/vault/${cardId}?revision=${revision}`
      : `/boards/${boardId}/vault/${cardId}`;
    return this._request('DELETE', path);
  }

  // ---- Board tokens ----

  /** @param {string} boardId @returns {Promise<object[]>} */
  async listBoardTokens(boardId) { return (await this._request('GET', `/boards/${boardId}/tokens`)).tokens; }

  /** @param {string} boardId @param {string} name @param {string} type @returns {Promise<object>} */
  async createBoardToken(boardId, name, type) { return (await this._request('POST', `/boards/${boardId}/tokens`, { name, type })).token; }

  /** @param {string} boardId @param {string} tokenId @returns {Promise<void>} */
  deleteBoardToken(boardId, tokenId) { return this._request('DELETE', `/boards/${boardId}/tokens/${tokenId}`); }

  // ---- Profile tokens ----

  /** @returns {Promise<object[]>} */
  async listProfileTokens() { return (await this._request('GET', '/me/tokens')).tokens; }

  /** @param {string} name @returns {Promise<object>} */
  async createProfileToken(name) { return (await this._request('POST', '/me/tokens', { name, type: 'programmatic' })).token; }

  /** @param {string} tokenId @returns {Promise<void>} */
  deleteProfileToken(tokenId) { return this._request('DELETE', `/me/tokens/${tokenId}`); }

  // ---- Org tokens ----

  /** @param {string} orgId @returns {Promise<object[]>} */
  async listOrgTokens(orgId) { return (await this._request('GET', `/organisations/${orgId}/tokens`)).tokens; }

  /** @param {string} orgId @param {string} name @returns {Promise<object>} */
  async createOrgToken(orgId, name) { return (await this._request('POST', `/organisations/${orgId}/tokens`, { name })).token; }

  /** @param {string} orgId @param {string} tokenId @returns {Promise<void>} */
  deleteOrgToken(orgId, tokenId) { return this._request('DELETE', `/organisations/${orgId}/tokens/${tokenId}`); }

  /**
   * @param {string} orgId
   * @param {string} tokenId
   * @param {{name?: string|null, avatar?: string|null}} config
   * @returns {Promise<object>}
   */
  async configureOrgBotToken(orgId, tokenId, config) {
    return (await this._request('PATCH', `/organisations/${orgId}/tokens/${tokenId}/bot`, config)).token;
  }
}

class PluginClient {
  /** @param {Function} request */
  constructor(request) { this._request = request; }

  /** @param {string} boardId @returns {Promise<object>} */
  async getBoard(boardId) { return (await this._request('GET', `/plugin/boards/${boardId}`)).board; }

  /** @param {string} boardId @param {string} cardId @param {string} itemId @returns {Promise<object>} */
  async toggleChecklistItem(boardId, cardId, itemId) {
    return (await this._request('POST', `/plugin/boards/${boardId}/cards/${cardId}/checklist-items/${itemId}/toggle`)).item;
  }

  /** @returns {Promise<unknown>} */
  getAccessLevel() { return this._request('GET', '/plugin/access-level'); }
}

/** @param {number} ms @returns {Promise<void>} */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
