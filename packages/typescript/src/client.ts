import { JokelboardError, JokelboardConfigurationError, RateLimitError, RevisionConflictError } from './errors.js';
import type { ErrorContext } from './errors.js';
import type {
  AddCommentOptions,
  Board,
  BoardCard,
  BoardData,
  BoardList,
  BoardSummary,
  BotConfig,
  CardLink,
  CardMatch,
  ChecklistItem,
  ClientOptions,
  CreateCardOptions,
  CreatedCard,
  MoveCardOptions,
  PatchCardFn,
  PluginBoard,
  RestoreCardOptions,
  Token,
  TokenType,
  UpdateCardFields,
  VaultEntry,
  WithFreshRevisionContext,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.jokelboard.com/api/v1';
const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_CONFLICT_RETRIES = 1;

// ---- Helpers ----

function normaliseBaseUrl(value: string): string {
  let url: URL;
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

function requireId(value: unknown, name: string): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || !String(value).trim()) {
    throw new JokelboardConfigurationError(`${name} must be a non-empty string or number.`);
  }
  return String(value).trim();
}

function encodeId(value: unknown, name: string): string {
  return encodeURIComponent(requireId(value, name));
}

function sanitiseComment(text: string): string {
  return text.replace(/[<>]/g, c => (c === '<' ? '&lt;' : '&gt;'));
}

export function findCard(board: Board, predicate: (card: BoardCard, list: BoardList) => boolean): CardMatch | null {
  for (const list of board?.data?.lists ?? []) {
    for (const card of Array.isArray(list.cards) ? list.cards : []) {
      if (predicate(card, list)) return { card, list };
    }
  }
  return null;
}

function redactToken(value: unknown, token: string): unknown {
  if (typeof value === 'string') return value.split(token).join('[REDACTED]');
  if (Array.isArray(value)) return value.map(v => redactToken(v, token));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactToken(v, token)]));
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- Board-scoped proxy ----

export class BoardClient {
  readonly id: string;

  readonly lists: Readonly<{
    create(title: string): Promise<BoardList>;
  }>;

  readonly cards: Readonly<{
    create(listId: string, title: string, options?: CreateCardOptions): Promise<CreatedCard>;
    update(cardId: string, fields: UpdateCardFields): Promise<BoardCard>;
    patch(cardId: string, patchOrFn: UpdateCardFields | PatchCardFn): Promise<BoardCard>;
    comment(cardId: string, text: string, options?: AddCommentOptions): Promise<void>;
    move(cardId: string, toListId: string, options?: MoveCardOptions): Promise<void>;
    link(cardId: string): Promise<string>;
    vault(cardId: string): Promise<void>;
    restore(cardId: string, options?: RestoreCardOptions): Promise<void>;
    find(predicate: (card: BoardCard, list: BoardList) => boolean): Promise<CardMatch | null>;
    get(cardId: string): Promise<BoardCard>;
    findByTitle(title: string): Promise<CardMatch | null>;
    findById(cardId: string): Promise<CardMatch | null>;
    customField(cardId: string, key: string): Promise<string | null>;
    customFields(cardId: string): Promise<Record<string, string>>;
    setCustomField(cardId: string, key: string, value: string | number): Promise<BoardCard>;
    setCustomFields(cardId: string, fields: Record<string, string | number>): Promise<BoardCard>;
  }>;

  readonly vault: Readonly<{
    list(): Promise<VaultEntry[]>;
    purge(cardId: string, revision?: number): Promise<void>;
  }>;

  readonly plugin: Readonly<{
    get(): Promise<PluginBoard>;
    toggleChecklistItem(cardId: string, itemId: string): Promise<ChecklistItem & { id: string }>;
  }>;

  private readonly _api: JokelboardClient;

  constructor(api: JokelboardClient, boardId: string) {
    this._api = api;
    this.id = boardId;

    this.lists = Object.freeze({
      create: (title: string) => api.createList(boardId, title),
    });

    this.cards = Object.freeze({
      create: (listId: string, title: string, options?: CreateCardOptions) =>
        api.createCard(boardId, listId, title, options),
      update: (cardId: string, fields: UpdateCardFields) =>
        api.updateCard(boardId, cardId, fields),
      patch: (cardId: string, patchOrFn: UpdateCardFields | PatchCardFn) =>
        api.patchCard(boardId, cardId, patchOrFn),
      comment: (cardId: string, text: string, options?: AddCommentOptions) =>
        api.addComment(boardId, cardId, text, options),
      move: (cardId: string, toListId: string, options?: MoveCardOptions) =>
        api.moveCard(boardId, cardId, toListId, options),
      link: (cardId: string) => api.getCardLink(boardId, cardId),
      vault: (cardId: string) => api.vaultCard(boardId, cardId),
      restore: (cardId: string, options?: RestoreCardOptions) =>
        api.restoreCard(boardId, cardId, options),
      find: (predicate: (card: BoardCard, list: BoardList) => boolean) =>
        api.findCard(boardId, predicate),
      get: (cardId: string) => api.getCard(boardId, cardId),
      findByTitle: (title: string) => api.findCardByTitle(boardId, title),
      findById: (cardId: string) => api.findCardById(boardId, cardId),
      customField: (cardId: string, key: string) =>
        api.getCustomField(boardId, cardId, key),
      customFields: (cardId: string) => api.getCustomFields(boardId, cardId),
      setCustomField: (cardId: string, key: string, value: string | number) =>
        api.setCustomField(boardId, cardId, key, value),
      setCustomFields: (cardId: string, fields: Record<string, string | number>) =>
        api.setCustomFields(boardId, cardId, fields),
    });

    this.vault = Object.freeze({
      list: () => api.getVault(boardId),
      purge: (cardId: string, revision?: number) => api.purgeCard(boardId, cardId, revision),
    });

    this.plugin = Object.freeze({
      get: () => api._plugin.getBoard(boardId),
      toggleChecklistItem: (cardId: string, itemId: string) =>
        api._plugin.toggleChecklistItem(boardId, cardId, itemId),
    });

    Object.freeze(this);
  }

  get(): Promise<Board> { return this._api.getBoard(this.id); }
  getLists(): Promise<BoardList[]> { return this._api.getLists(this.id); }
  replace(boardData: BoardData, revision?: number): Promise<Board> {
    return this._api.replaceBoard(this.id, boardData, revision);
  }
  withFreshRevision(
    operation: (ctx: WithFreshRevisionContext) => Promise<unknown>,
    options?: { retries?: number },
  ): Promise<unknown> {
    return this._api.withFreshRevision(this.id, operation, options);
  }
}

// ---- Main client ----

export class JokelboardClient {
  private readonly _token: string;
  private readonly _baseUrl: string;
  private readonly _timeout: number;
  private readonly _retryOnRateLimit: boolean;
  private readonly _maxRetries: number;
  private readonly _maxConflictRetries: number;
  private readonly _fetchImpl: typeof fetch;
  private readonly _writeTails = new Map<string, Promise<void>>();

  readonly defaultBoardId: string | null;

  readonly boards: Readonly<{
    list(): Promise<BoardSummary[]>;
    get(boardId?: string | null): Promise<Board>;
    replace(boardId: string, data: BoardData, revision?: number): Promise<Board>;
  }>;

  readonly lists: Readonly<{
    create(boardId: string, title: string): Promise<BoardList>;
  }>;

  readonly cards: Readonly<{
    create(boardId: string, listId: string, title: string, options?: CreateCardOptions): Promise<CreatedCard>;
    update(boardId: string, cardId: string, fields: UpdateCardFields): Promise<BoardCard>;
    patch(boardId: string, cardId: string, patchOrFn: UpdateCardFields | PatchCardFn): Promise<BoardCard>;
    comment(boardId: string, cardId: string, text: string, options?: AddCommentOptions): Promise<void>;
    move(boardId: string, cardId: string, toListId: string, options?: MoveCardOptions): Promise<void>;
    link(boardId: string, cardId: string): Promise<string>;
    vault(boardId: string, cardId: string): Promise<void>;
    restore(boardId: string, cardId: string, options?: RestoreCardOptions): Promise<void>;
    find(boardId: string, predicate: (card: BoardCard, list: BoardList) => boolean): Promise<CardMatch | null>;
  }>;

  readonly vault: Readonly<{
    list(boardId: string): Promise<VaultEntry[]>;
    purge(boardId: string, cardId: string, revision?: number): Promise<void>;
  }>;

  /** @internal */
  readonly _plugin: PluginClient;

  readonly plugin: Readonly<{
    getAccessLevel(): Promise<unknown>;
    getBoard(boardId: string): Promise<PluginBoard>;
    toggleChecklistItem(boardId: string, cardId: string, itemId: string): Promise<ChecklistItem & { id: string }>;
  }>;

  constructor(options: ClientOptions) {
    const t = requireId(options.token, 'token');
    if (!t.startsWith('jkb_') || t.length > 256 || /\s/.test(t)) {
      throw new JokelboardConfigurationError('token is not a valid Jokelboard API token.');
    }
    this._token = t;

    if (options.fetchImpl !== undefined && options.fetchImpl !== null && typeof options.fetchImpl !== 'function') {
      throw new JokelboardConfigurationError('fetchImpl must be a function.');
    }
    const fetchImpl = (options.fetchImpl ?? globalThis.fetch) as typeof fetch;
    if (!fetchImpl) {
      throw new JokelboardConfigurationError('No fetch() available. Pass fetchImpl or use Node 18+.');
    }
    this._fetchImpl = fetchImpl;

    this._baseUrl = normaliseBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this._timeout = Number.isFinite(options.timeout) ? Math.max(1, options.timeout!) : DEFAULT_TIMEOUT;
    this._retryOnRateLimit = options.retryOnRateLimit !== false;
    this._maxRetries = Number.isInteger(options.maxRetries) ? Math.max(0, options.maxRetries!) : DEFAULT_MAX_RETRIES;
    this._maxConflictRetries = Number.isInteger(options.maxConflictRetries)
      ? Math.max(0, options.maxConflictRetries!)
      : DEFAULT_MAX_CONFLICT_RETRIES;
    this.defaultBoardId = options.defaultBoardId ? requireId(options.defaultBoardId, 'defaultBoardId') : null;

    this.boards = Object.freeze({
      list: () => this.listBoards(),
      get: (boardId?: string | null) => this.getBoard(boardId),
      replace: (boardId: string, data: BoardData, revision?: number) => this.replaceBoard(boardId, data, revision),
    });

    this.lists = Object.freeze({
      create: (boardId: string, title: string) => this.createList(boardId, title),
    });

    this.cards = Object.freeze({
      create: (boardId: string, listId: string, title: string, options?: CreateCardOptions) =>
        this.createCard(boardId, listId, title, options),
      update: (boardId: string, cardId: string, fields: UpdateCardFields) =>
        this.updateCard(boardId, cardId, fields),
      patch: (boardId: string, cardId: string, patchOrFn: UpdateCardFields | PatchCardFn) =>
        this.patchCard(boardId, cardId, patchOrFn),
      comment: (boardId: string, cardId: string, text: string, options?: AddCommentOptions) =>
        this.addComment(boardId, cardId, text, options),
      move: (boardId: string, cardId: string, toListId: string, options?: MoveCardOptions) =>
        this.moveCard(boardId, cardId, toListId, options),
      link: (boardId: string, cardId: string) => this.getCardLink(boardId, cardId),
      vault: (boardId: string, cardId: string) => this.vaultCard(boardId, cardId),
      restore: (boardId: string, cardId: string, options?: RestoreCardOptions) =>
        this.restoreCard(boardId, cardId, options),
      find: (boardId: string, predicate: (card: BoardCard, list: BoardList) => boolean) =>
        this.findCard(boardId, predicate),
    });

    this.vault = Object.freeze({
      list: (boardId: string) => this.getVault(boardId),
      purge: (boardId: string, cardId: string, revision?: number) => this.purgeCard(boardId, cardId, revision),
    });

    this._plugin = new PluginClient(this._request.bind(this));
    this.plugin = Object.freeze({
      getAccessLevel: () => this._plugin.getAccessLevel(),
      getBoard: (boardId: string) => this._plugin.getBoard(boardId),
      toggleChecklistItem: (boardId: string, cardId: string, itemId: string) =>
        this._plugin.toggleChecklistItem(boardId, cardId, itemId),
    });
  }

  // ---- Core HTTP ----

  private async _request<T>(method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._timeout);
    const hasBody = body !== undefined;
    const ctx: ErrorContext = { method, path };

    let res: Response;
    try {
      res = await this._fetchImpl(`${this._baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this._token}`,
          ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        },
        body: hasBody ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      if ((err as { name?: string })?.name === 'AbortError') {
        throw new JokelboardError('request_timeout', 'Request timed out.', null, null, ctx);
      }
      throw new JokelboardError('network_error', 'Unable to reach the Jokelboard API.', null, null, ctx);
    }
    clearTimeout(timer);

    const raw = await res.text();
    let data: unknown = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch { /* non-JSON */ }
    }
    const redacted = this._redact(data);

    if (res.ok) return data as T;

    if (res.status === 429) {
      const retryAfter = (data as { retryAfter?: number })?.retryAfter
        ?? (Number(res.headers.get('retry-after')) || 1);
      if (this._retryOnRateLimit && attempt < this._maxRetries) {
        await sleep(retryAfter * 1000);
        return this._request<T>(method, path, body, attempt + 1);
      }
      throw new RateLimitError(
        (data as { message?: string })?.message ?? 'Rate limit exceeded.',
        retryAfter,
        redacted,
        ctx,
      );
    }

    if (res.status === 409 && (data as { error?: string })?.error === 'revision_conflict') {
      throw new RevisionConflictError(
        (data as { message?: string })?.message ?? 'Revision conflict.',
        (data as { currentRevision?: number })?.currentRevision ?? null,
        redacted,
        ctx,
      );
    }

    throw new JokelboardError(
      ((data as { error?: string })?.error ?? 'http_error') as string,
      (data as { message?: string })?.message ?? `HTTP ${res.status}`,
      res.status,
      redacted,
      ctx,
    );
  }

  private _redact(value: unknown): unknown {
    return redactToken(value, this._token);
  }

  // ---- Revision-safe write queue ----

  private _withRevision<T>(boardId: string, operation: (board: Board, revision: number) => Promise<T>): Promise<T> {
    if (!this._writeTails.has(boardId)) {
      this._writeTails.set(boardId, Promise.resolve());
    }

    const result = this._writeTails.get(boardId)!.then(async () => {
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
      throw new Error('Unreachable revision retry state.');
    });

    this._writeTails.set(boardId, result.then(() => {}, () => {}));
    return result;
  }

  withFreshRevision(
    boardId: string | null | undefined,
    operation: (ctx: WithFreshRevisionContext) => Promise<unknown>,
    options: { retries?: number } = {},
  ): Promise<unknown> {
    if (typeof operation !== 'function') {
      throw new JokelboardConfigurationError('operation must be a function.');
    }
    const id = this.resolveBoardId(boardId);
    const boardClient = this.board(id);
    return this._withRevision(id, (board, revision) =>
      operation({ revision, board, boardClient, attempt: 1 }),
    );
  }

  resolveBoardId(boardId: string | null | undefined): string {
    const resolved = boardId ?? this.defaultBoardId;
    if (resolved == null) {
      throw new JokelboardConfigurationError(
        'boardId is required. Pass one directly or set defaultBoardId on the client.',
      );
    }
    return requireId(resolved, 'boardId');
  }

  board(boardId?: string | null): BoardClient {
    return new BoardClient(this, this.resolveBoardId(boardId));
  }

  // ---- Me ----

  async getMe(): Promise<{ user: { sub: string; username: string; displayName: string; picture: string; tier: string }; token: Token }> {
    const d = await this._request<{ user: unknown; token: unknown }>('GET', '/me');
    if (!d?.user || !d?.token) {
      throw new JokelboardError('invalid_response', 'Invalid identity response.', null, d);
    }
    return d as never;
  }

  // ---- Boards ----

  async listBoards(): Promise<BoardSummary[]> {
    const d = await this._request<{ boards: BoardSummary[] }>('GET', '/boards');
    if (!Array.isArray(d?.boards)) {
      throw new JokelboardError('invalid_response', 'Invalid board list response.', null, d);
    }
    return d.boards;
  }

  async getBoard(boardId?: string | null): Promise<Board> {
    const id = this.resolveBoardId(boardId);
    const d = await this._request<{ board: Board }>('GET', `/boards/${encodeId(id, 'boardId')}`);
    if (!d?.board?.data || !Array.isArray(d.board.data.lists)) {
      throw new JokelboardError('invalid_response', 'Invalid board response.', null, d);
    }
    return d.board;
  }

  async getLists(boardId?: string | null): Promise<BoardList[]> {
    const board = await this.getBoard(boardId);
    return board.data.lists;
  }

  async findCard(boardId: string, predicate: (card: BoardCard, list: BoardList) => boolean): Promise<CardMatch | null> {
    const board = await this.getBoard(boardId);
    return findCard(board, predicate);
  }

  async getCard(boardId: string, cardId: string): Promise<BoardCard> {
    const cleanCardId = requireId(cardId, 'cardId');
    const board = await this.getBoard(boardId);
    const match = findCard(board, c => c.id === cleanCardId);
    if (!match) {
      throw new JokelboardError('card_not_found', `Card "${cleanCardId}" not found on board.`, 404, null);
    }
    return match.card;
  }

  async findCardByTitle(boardId: string, title: string): Promise<CardMatch | null> {
    const target = requireId(title, 'title').toLowerCase();
    const board = await this.getBoard(boardId);
    return findCard(board, c => typeof c.title === 'string' && c.title.trim().toLowerCase() === target);
  }

  async findCardById(boardId: string, cardId: string): Promise<CardMatch | null> {
    const target = requireId(cardId, 'cardId');
    const board = await this.getBoard(boardId);
    return findCard(board, c => c.id === target);
  }

  async replaceBoard(boardId: string, boardData: BoardData, revision?: number): Promise<Board> {
    const id = this.resolveBoardId(boardId);
    const d = await this._request<{ board: Board }>('PUT', `/boards/${encodeId(id, 'boardId')}`, {
      data: boardData,
      ...(revision !== undefined && { revision }),
    });
    return d.board;
  }

  // ---- Lists ----

  async createList(boardId: string, title: string): Promise<BoardList> {
    const id = this.resolveBoardId(boardId);
    const cleanTitle = requireId(title, 'title');
    return this._withRevision(id, (_, revision) =>
      this._request('POST', `/boards/${encodeId(id, 'boardId')}/lists`, { title: cleanTitle, revision }),
    );
  }

  // ---- Cards ----

  async createCard(boardId: string, listId: string, title: string, options?: CreateCardOptions): Promise<CreatedCard> {
    const id = this.resolveBoardId(boardId);
    const cleanTitle = requireId(title, 'title');
    const cleanListId = requireId(listId, 'listId');
    return this._withRevision(id, async (board, revision) => {
      if (!board.data.lists.some(l => l.id === cleanListId)) {
        throw new JokelboardConfigurationError(`List "${cleanListId}" does not exist on this board.`);
      }
      const d = await this._request<{ card: CreatedCard }>('POST', `/boards/${encodeId(id, 'boardId')}/cards`, {
        listId: cleanListId,
        title: cleanTitle,
        ...options,
        revision,
      });
      return d.card;
    });
  }

  async updateCard(boardId: string, cardId: string, fields: UpdateCardFields): Promise<BoardCard> {
    const id = this.resolveBoardId(boardId);
    const d = await this._request<{ card: BoardCard }>(
      'PATCH',
      `/boards/${encodeId(id, 'boardId')}/cards/${encodeId(cardId, 'cardId')}`,
      fields,
    );
    return d.card;
  }

  async patchCard(boardId: string, cardId: string, patchOrFn: UpdateCardFields | PatchCardFn): Promise<BoardCard> {
    const id = this.resolveBoardId(boardId);
    const cleanCardId = requireId(cardId, 'cardId');
    return this._withRevision(id, async (board, revision) => {
      let patch: UpdateCardFields;
      if (typeof patchOrFn === 'function') {
        const match = findCard(board, c => c.id === cleanCardId);
        if (!match) {
          throw new JokelboardError('card_not_found', `Card "${cleanCardId}" not found on board.`, 404, null);
        }
        patch = await patchOrFn(match.card, match.list, board);
      } else {
        patch = patchOrFn;
      }
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new JokelboardConfigurationError('Card patch must resolve to a plain object.');
      }
      const d = await this._request<{ card: BoardCard }>(
        'PATCH',
        `/boards/${encodeId(id, 'boardId')}/cards/${encodeId(cleanCardId, 'cardId')}`,
        { ...patch, revision },
      );
      return d.card;
    });
  }

  // ---- Custom fields ----

  async getCustomFields(boardId: string, cardId: string): Promise<Record<string, string>> {
    const card = await this.getCard(boardId, cardId);
    return card.fieldValues ?? {};
  }

  async getCustomField(boardId: string, cardId: string, fieldKey: string): Promise<string | null> {
    requireId(fieldKey, 'fieldKey');
    const fields = await this.getCustomFields(boardId, cardId);
    return fields[fieldKey] ?? null;
  }

  setCustomField(boardId: string, cardId: string, fieldKey: string, value: string | number): Promise<BoardCard> {
    requireId(fieldKey, 'fieldKey');
    return this.patchCard(boardId, cardId, card => ({
      fieldValues: { ...(card.fieldValues ?? {}), [fieldKey]: String(value) },
    }));
  }

  setCustomFields(boardId: string, cardId: string, fields: Record<string, string | number>): Promise<BoardCard> {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      throw new JokelboardConfigurationError('fields must be a plain object.');
    }
    const normalised = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)]));
    return this.patchCard(boardId, cardId, card => ({
      fieldValues: { ...(card.fieldValues ?? {}), ...normalised },
    }));
  }

  // ---- Move / link / comment ----

  async moveCard(boardId: string, cardId: string, toListId: string, options: MoveCardOptions = {}): Promise<void> {
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

  async getCardLink(boardId: string, cardId: string): Promise<string> {
    const id = this.resolveBoardId(boardId);
    const d = await this._request<{ url: string }>(
      'GET',
      `/boards/${encodeId(id, 'boardId')}/cards/${encodeId(cardId, 'cardId')}/link`,
    );
    if (typeof d?.url !== 'string' || !d.url) {
      throw new JokelboardError('invalid_response', 'Invalid card link response.', null, d);
    }
    return d.url;
  }

  async addComment(boardId: string, cardId: string, text: string, options: AddCommentOptions = {}): Promise<void> {
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

  async getVault(boardId: string): Promise<VaultEntry[]> {
    const id = this.resolveBoardId(boardId);
    const d = await this._request<{ vault: VaultEntry[] }>('GET', `/boards/${encodeId(id, 'boardId')}/vault`);
    return d.vault;
  }

  async vaultCard(boardId: string, cardId: string): Promise<void> {
    const id = this.resolveBoardId(boardId);
    return this._withRevision(id, (_, revision) =>
      this._request(
        'POST',
        `/boards/${encodeId(id, 'boardId')}/cards/${encodeId(cardId, 'cardId')}/vault`,
        { revision },
      ),
    );
  }

  async restoreCard(boardId: string, cardId: string, options: RestoreCardOptions = {}): Promise<void> {
    const id = this.resolveBoardId(boardId);
    return this._withRevision(id, (_, revision) =>
      this._request(
        'POST',
        `/boards/${encodeId(id, 'boardId')}/cards/${encodeId(cardId, 'cardId')}/restore`,
        { ...options, revision },
      ),
    );
  }

  async purgeCard(boardId: string, cardId: string, revision?: number): Promise<void> {
    const id = this.resolveBoardId(boardId);
    const path = `/boards/${encodeId(id, 'boardId')}/vault/${encodeId(cardId, 'cardId')}`;
    await this._request('DELETE', revision !== undefined ? `${path}?revision=${revision}` : path);
  }

  // ---- Board tokens ----

  async listBoardTokens(boardId: string): Promise<Token[]> {
    const id = this.resolveBoardId(boardId);
    return (await this._request<{ tokens: Token[] }>('GET', `/boards/${encodeId(id, 'boardId')}/tokens`)).tokens;
  }

  async createBoardToken(boardId: string, name: string, type: TokenType): Promise<Token> {
    const id = this.resolveBoardId(boardId);
    return (await this._request<{ token: Token }>('POST', `/boards/${encodeId(id, 'boardId')}/tokens`, { name, type })).token;
  }

  async deleteBoardToken(boardId: string, tokenId: string): Promise<void> {
    const id = this.resolveBoardId(boardId);
    await this._request('DELETE', `/boards/${encodeId(id, 'boardId')}/tokens/${encodeId(tokenId, 'tokenId')}`);
  }

  // ---- Profile tokens ----

  async listProfileTokens(): Promise<Token[]> {
    return (await this._request<{ tokens: Token[] }>('GET', '/me/tokens')).tokens;
  }

  async createProfileToken(name: string): Promise<Token> {
    return (await this._request<{ token: Token }>('POST', '/me/tokens', { name, type: 'programmatic' })).token;
  }

  async deleteProfileToken(tokenId: string): Promise<void> {
    await this._request('DELETE', `/me/tokens/${encodeId(tokenId, 'tokenId')}`);
  }

  // ---- Org tokens ----

  async listOrgTokens(orgId: string): Promise<Token[]> {
    return (await this._request<{ tokens: Token[] }>('GET', `/organisations/${encodeId(orgId, 'orgId')}/tokens`)).tokens;
  }

  async createOrgToken(orgId: string, name: string): Promise<Token> {
    return (await this._request<{ token: Token }>('POST', `/organisations/${encodeId(orgId, 'orgId')}/tokens`, { name })).token;
  }

  async deleteOrgToken(orgId: string, tokenId: string): Promise<void> {
    await this._request('DELETE', `/organisations/${encodeId(orgId, 'orgId')}/tokens/${encodeId(tokenId, 'tokenId')}`);
  }

  async configureOrgBotToken(orgId: string, tokenId: string, config: BotConfig): Promise<Token> {
    return (await this._request<{ token: Token }>(
      'PATCH',
      `/organisations/${encodeId(orgId, 'orgId')}/tokens/${encodeId(tokenId, 'tokenId')}/bot`,
      config,
    )).token;
  }
}

// ---- Plugin client ----

class PluginClient {
  constructor(private readonly req: <T>(method: string, path: string, body?: unknown) => Promise<T>) {}

  async getBoard(boardId: string): Promise<PluginBoard> {
    const d = await this.req<{ board: PluginBoard }>('GET', `/plugin/boards/${encodeId(boardId, 'boardId')}`);
    return d.board;
  }

  async toggleChecklistItem(boardId: string, cardId: string, itemId: string): Promise<ChecklistItem & { id: string }> {
    const d = await this.req<{ item: ChecklistItem & { id: string } }>(
      'POST',
      `/plugin/boards/${encodeId(boardId, 'boardId')}/cards/${encodeId(cardId, 'cardId')}/checklist-items/${encodeId(itemId, 'itemId')}/toggle`,
    );
    return d.item;
  }

  async getAccessLevel(): Promise<unknown> {
    return this.req('GET', '/plugin/access-level');
  }
}
