export type TokenScope = 'boards:read' | 'boards:write' | 'plugin:checklist';
export type TokenKind = 'board' | 'profile' | 'org';
export type TokenType = 'programmatic' | 'plugin';
export type DescriptionMode = 'plain' | 'markdown' | 'fields';
export type DescriptionSize = 'small' | 'normal' | 'large';
export type DateType = 'due' | 'static' | 'employee';
export type CommentKind = 'comment' | 'docucomment';
export type FieldPresetType = 'checkbox' | 'text';

export interface Label {
  id?: string;
  name: string;
  color?: string;
  twoTone?: boolean;
  borderColor?: string;
}

export interface ChecklistItem {
  id?: string;
  text: string;
  done: boolean;
}

export interface Checklist {
  items: ChecklistItem[];
}

export interface Attachment {
  id?: string;
  name: string;
  url: string;
}

export interface DueDate {
  iso?: string;
  in?: string;
  overdue?: boolean;
}

export interface Comment {
  id: string;
  author: string;
  authorSub?: string;
  botTokenId?: string;
  botOrgId?: string;
  text: string;
  ts: number;
  kind?: CommentKind;
}

export interface BoardCard {
  id: string;
  kind?: string;
  ticket?: string;
  createdAt?: number;
  title: string;
  categoryId?: string;
  severity?: string;
  description?: string;
  descriptionMode?: DescriptionMode;
  descriptionSize?: DescriptionSize;
  fieldValues?: Record<string, string>;
  labels?: Label[];
  assignees?: string[];
  comments?: Comment[];
  checklist?: Checklist;
  attachments?: Attachment[];
  due?: DueDate | null;
  dateType?: DateType;
  dueJoin?: { iso: string } | null;
  dueDepart?: { iso: string } | null;
  image?: { data: string; w: number; h: number; bytes: number } | null;
  components?: Record<string, boolean>;
  vaultedAt?: number;
  vaultedBy?: string | null;
}

export interface BoardList {
  id: string;
  title: string;
  cards: BoardCard[];
  vaultedCards?: BoardCard[];
}

export interface BoardData {
  title?: string;
  lists: BoardList[];
  presets?: {
    labels?: Array<{ id: string; name: string; color: string; twoTone?: boolean; borderColor?: string }>;
    checklists?: Array<{ id: string; name: string; items: string[] }>;
    fields?: Array<{ id: string; name: string; type: FieldPresetType }>;
    cardCategory?: {
      name: string;
      defaultOptionId: string;
      options: Array<{ id: string; label: string; color: string }>;
    };
    cards?: { default?: Record<string, unknown>; templates?: Array<Record<string, unknown>> };
  };
  [key: string]: unknown;
}

export interface BoardSummary {
  id: string;
  workspace: string;
  name: string;
  title: string;
  created_at: number;
  updated_at: number;
  revision: number;
  url: string;
}

export interface Board extends BoardSummary {
  data: BoardData;
}

export interface Token {
  id: string;
  kind: TokenKind;
  name: string;
  tokenPrefix: string;
  scopes: TokenScope[];
  boardId: string | null;
  orgId: string | null;
  createdBySub: string | null;
  created_at: number;
  last_used_at: number | null;
  bot: { name?: string; picture?: string } | null;
}

export interface MeUser {
  sub: string;
  username: string;
  displayName: string;
  picture: string;
  tier: string;
}

export interface VaultedCard {
  id: string;
  title: string;
  vaultedAt: number;
  vaultedBy: string | null;
}

export interface VaultEntry {
  listId: string;
  listTitle: string;
  cards: VaultedCard[];
}

export interface PluginCard {
  id: string;
  title: string;
  checklist?: Checklist;
}

export interface PluginList {
  id: string;
  title: string;
  cards: PluginCard[];
}

export interface PluginBoard {
  id: string;
  name: string;
  lists: PluginList[];
}

export interface CreatedCard {
  id: string;
  ticket?: string;
  createdAt: number;
  title: string;
  categoryId?: string;
}

export interface CardLink {
  cardId: string;
  listId: string;
  boardId: string;
  canonical: boolean;
  path: string;
  url: string;
}

// ---- Request option types ----

export interface CreateCardOptions {
  categoryId?: string;
  description?: string;
  descriptionMode?: DescriptionMode;
  descriptionSize?: DescriptionSize;
  dateType?: DateType;
  labels?: Label[];
  assignees?: string[];
  due?: { iso: string };
  checklist?: Checklist;
  attachments?: Attachment[];
  revision?: number;
}

export interface UpdateCardFields {
  title?: string;
  description?: string;
  descriptionMode?: DescriptionMode;
  descriptionSize?: DescriptionSize;
  fieldValues?: Record<string, string> | null;
  categoryId?: string;
  labels?: Label[];
  assignees?: string[];
  dateType?: DateType;
  due?: { iso: string } | null;
  dueJoin?: { iso: string } | null;
  dueDepart?: { iso: string } | null;
  checklist?: Checklist;
  attachments?: Attachment[];
  revision?: number;
}

export interface CreateListOptions {
  id?: string;
  revision?: number;
}

export interface AddCommentOptions {
  kind?: CommentKind;
  revision?: number;
}

export interface MoveCardOptions {
  position?: number;
  revision?: number;
}

export interface RestoreCardOptions {
  toListId?: string;
  position?: number;
  revision?: number;
}

export interface BotConfig {
  name?: string | null;
  avatar?: string | null;
}

export interface ClientOptions {
  token: string;
  baseUrl?: string;
  timeout?: number;
  retryOnRateLimit?: boolean;
  maxRetries?: number;
}
