import { JokelboardError, RateLimitError, RevisionConflictError } from './errors.js';
import type {
  AddCommentOptions,
  Board,
  BoardCard,
  BoardData,
  BoardSummary,
  BotConfig,
  CardLink,
  ChecklistItem,
  ClientOptions,
  CreateCardOptions,
  CreateListOptions,
  CreatedCard,
  MoveCardOptions,
  PluginBoard,
  RestoreCardOptions,
  Token,
  TokenType,
  UpdateCardFields,
  VaultEntry,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.jokelboard.com/api/v1';
const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_MAX_RETRIES = 3;

export class JokelboardClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly retryOnRateLimit: boolean;
  private readonly maxRetries: number;

  readonly plugin: PluginClient;

  constructor(options: ClientOptions) {
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.retryOnRateLimit = options.retryOnRateLimit ?? true;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.plugin = new PluginClient(this.request.bind(this));
  }

  private async request<T>(method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const data = await res.json().catch(() => null);

    if (res.ok) return data as T;

    if (res.status === 429 && this.retryOnRateLimit && attempt < this.maxRetries) {
      const retryAfter = (data as { retryAfter?: number })?.retryAfter ?? 1;
      await sleep(retryAfter * 1000);
      return this.request<T>(method, path, body, attempt + 1);
    }

    if (res.status === 429) {
      const d = data as { message?: string; retryAfter?: number; limit?: number; windowMs?: number };
      throw new RateLimitError(d?.message ?? 'Rate limit exceeded', d?.retryAfter ?? 1, d?.limit ?? 10, d?.windowMs ?? 5000, data);
    }

    if (res.status === 409 && (data as { error?: string })?.error === 'revision_conflict') {
      const d = data as { message?: string; currentRevision?: number };
      throw new RevisionConflictError(d?.message ?? 'Revision conflict', d?.currentRevision ?? 0, data);
    }

    const d = data as { error?: string; message?: string } | null;
    throw new JokelboardError(d?.error ?? 'unknown_error', d?.message ?? `HTTP ${res.status}`, res.status, data);
  }

  // ---- Me ----

  async getMe(): Promise<{ user: { sub: string; username: string; displayName: string; picture: string; tier: string }; token: Token }> {
    return this.request('GET', '/me');
  }

  // ---- Boards ----

  async listBoards(): Promise<BoardSummary[]> {
    const data = await this.request<{ boards: BoardSummary[] }>('GET', '/boards');
    return data.boards;
  }

  async getBoard(boardId: string): Promise<Board> {
    const data = await this.request<{ board: Board }>('GET', `/boards/${boardId}`);
    return data.board;
  }

  async replaceBoard(boardId: string, boardData: BoardData, revision?: number): Promise<Board> {
    const data = await this.request<{ board: Board }>('PUT', `/boards/${boardId}`, {
      data: boardData,
      ...(revision !== undefined && { revision }),
    });
    return data.board;
  }

  // ---- Lists ----

  async createList(boardId: string, title: string, options?: CreateListOptions): Promise<{ id: string; title: string; cards: BoardCard[] }> {
    const data = await this.request<{ ok: boolean; list: { id: string; title: string; cards: BoardCard[] } }>(
      'POST', `/boards/${boardId}/lists`, { title, ...options },
    );
    return data.list;
  }

  // ---- Cards ----

  async createCard(boardId: string, listId: string, title: string, options?: CreateCardOptions): Promise<CreatedCard> {
    const data = await this.request<{ ok: boolean; card: CreatedCard }>(
      'POST', `/boards/${boardId}/cards`, { listId, title, ...options },
    );
    return data.card;
  }

  async updateCard(boardId: string, cardId: string, fields: UpdateCardFields): Promise<BoardCard> {
    const data = await this.request<{ card: BoardCard }>('PATCH', `/boards/${boardId}/cards/${cardId}`, fields);
    return data.card;
  }

  async moveCard(boardId: string, cardId: string, toListId: string, options?: MoveCardOptions): Promise<void> {
    await this.request('POST', `/boards/${boardId}/cards/${cardId}/move`, { toListId, ...options });
  }

  async getCardLink(boardId: string, cardId: string): Promise<CardLink> {
    return this.request('GET', `/boards/${boardId}/cards/${cardId}/link`);
  }

  async addComment(boardId: string, cardId: string, text: string, options?: AddCommentOptions): Promise<void> {
    await this.request('POST', `/boards/${boardId}/cards/${cardId}/comments`, { text, ...options });
  }

  // ---- Vault ----

  async getVault(boardId: string): Promise<VaultEntry[]> {
    const data = await this.request<{ vault: VaultEntry[] }>('GET', `/boards/${boardId}/vault`);
    return data.vault;
  }

  async vaultCard(boardId: string, cardId: string, revision?: number): Promise<void> {
    await this.request('POST', `/boards/${boardId}/cards/${cardId}/vault`, revision !== undefined ? { revision } : undefined);
  }

  async restoreCard(boardId: string, cardId: string, options?: RestoreCardOptions): Promise<void> {
    await this.request('POST', `/boards/${boardId}/cards/${cardId}/restore`, options);
  }

  async purgeCard(boardId: string, cardId: string, revision?: number): Promise<void> {
    const path = revision !== undefined
      ? `/boards/${boardId}/vault/${cardId}?revision=${revision}`
      : `/boards/${boardId}/vault/${cardId}`;
    await this.request('DELETE', path);
  }

  // ---- Board tokens ----

  async listBoardTokens(boardId: string): Promise<Token[]> {
    const data = await this.request<{ tokens: Token[] }>('GET', `/boards/${boardId}/tokens`);
    return data.tokens;
  }

  async createBoardToken(boardId: string, name: string, type: TokenType): Promise<Token> {
    const data = await this.request<{ token: Token }>('POST', `/boards/${boardId}/tokens`, { name, type });
    return data.token;
  }

  async deleteBoardToken(boardId: string, tokenId: string): Promise<void> {
    await this.request('DELETE', `/boards/${boardId}/tokens/${tokenId}`);
  }

  // ---- Profile tokens ----

  async listProfileTokens(): Promise<Token[]> {
    const data = await this.request<{ tokens: Token[] }>('GET', '/me/tokens');
    return data.tokens;
  }

  async createProfileToken(name: string): Promise<Token> {
    const data = await this.request<{ token: Token }>('POST', '/me/tokens', { name, type: 'programmatic' });
    return data.token;
  }

  async deleteProfileToken(tokenId: string): Promise<void> {
    await this.request('DELETE', `/me/tokens/${tokenId}`);
  }

  // ---- Org tokens ----

  async listOrgTokens(orgId: string): Promise<Token[]> {
    const data = await this.request<{ tokens: Token[] }>('GET', `/organisations/${orgId}/tokens`);
    return data.tokens;
  }

  async createOrgToken(orgId: string, name: string): Promise<Token> {
    const data = await this.request<{ token: Token }>('POST', `/organisations/${orgId}/tokens`, { name });
    return data.token;
  }

  async deleteOrgToken(orgId: string, tokenId: string): Promise<void> {
    await this.request('DELETE', `/organisations/${orgId}/tokens/${tokenId}`);
  }

  async configureOrgBotToken(orgId: string, tokenId: string, config: BotConfig): Promise<Token> {
    const data = await this.request<{ token: Token }>(
      'PATCH', `/organisations/${orgId}/tokens/${tokenId}/bot`, config,
    );
    return data.token;
  }
}

class PluginClient {
  constructor(private readonly req: <T>(method: string, path: string, body?: unknown) => Promise<T>) {}

  async getBoard(boardId: string): Promise<PluginBoard> {
    const data = await this.req<{ board: PluginBoard }>('GET', `/plugin/boards/${boardId}`);
    return data.board;
  }

  async toggleChecklistItem(boardId: string, cardId: string, itemId: string): Promise<ChecklistItem & { id: string }> {
    const data = await this.req<{ ok: boolean; item: ChecklistItem & { id: string } }>(
      'POST', `/plugin/boards/${boardId}/cards/${cardId}/checklist-items/${itemId}/toggle`,
    );
    return data.item;
  }

  async getAccessLevel(): Promise<unknown> {
    return this.req('GET', '/plugin/access-level');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
