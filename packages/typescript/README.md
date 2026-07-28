# @yeetgodpro1324/jokelboard-ts

TypeScript client for the [Jokelboard](https://jokelboard.com) API. Strict types, ESM + CJS dual build.

## Installation

```bash
npm install @yeetgodpro1324/jokelboard-ts
```

## Quick start

```ts
import { JokelboardClient } from '@yeetgodpro1324/jokelboard-ts';

const client = new JokelboardClient({ token: process.env.JKB_TOKEN! });

const boards = await client.listBoards();
const b = client.board('my-board-id');
const lists = await b.getLists();
const match = await b.cards.findByTitle('Fix the bug');
```

## Constructor options

```ts
const client = new JokelboardClient({
  token: 'jkb_...',           // required — must start with jkb_
  defaultBoardId: 'abc123',   // optional fallback when boardId is omitted
  baseUrl: 'https://...',     // override base URL (HTTPS required)
  timeout: 10_000,            // request timeout in ms (default: 10 000)
  retryOnRateLimit: true,     // auto-retry on 429 (default: true)
  maxRetries: 3,              // max 429 retry attempts (default: 3)
  maxConflictRetries: 1,      // max revision-conflict retries (default: 1)
  fetchImpl: myFetch,         // custom fetch (useful for testing)
});
```

## Board proxy

`client.board(boardId?)` returns a `BoardClient` scoped to a board. If `defaultBoardId`
is set you can call `client.board()` with no argument.

```ts
const b = client.board('board-id');

await b.get();                     // Board
await b.getLists();                // BoardList[]
await b.replace(data);
await b.withFreshRevision(async ({ revision, board, boardClient }) => { /* ... */ });

// Cards namespace — all revision-safe
await b.cards.get('card-id');                      // BoardCard (throws if not found)
await b.cards.findByTitle('My task');              // CardMatch | null
await b.cards.findById('card-id');                 // CardMatch | null
await b.cards.create('list-id', 'Title');
await b.cards.update('card-id', fields);
await b.cards.patch('card-id', { title: 'Done' });
await b.cards.patch('card-id', (card, list, board) => ({ title: card.title + ' ✓' }));
await b.cards.comment('card-id', 'Hello');
await b.cards.move('card-id', 'dest-list-id');
await b.cards.vault('card-id');
await b.cards.restore('card-id', { toListId: 'list-id' });
await b.cards.customField('card-id', 'key');
await b.cards.setCustomField('card-id', 'key', 'value');
await b.cards.setCustomFields('card-id', { key1: 'a', key2: 'b' });

// Vault namespace
await b.vault.list();
await b.vault.purge('card-id');

// Plugin namespace
await b.plugin.get();
await b.plugin.toggleChecklistItem('card-id', 'item-id');
```

## Namespaced APIs on the main client

```ts
client.boards.list()
client.boards.get('board-id')
client.boards.replace('board-id', data, revision)

client.lists.create('board-id', 'List title')

client.cards.create('board-id', 'list-id', 'Title')
client.cards.patch('board-id', 'card-id', patchOrFn)
client.cards.move('board-id', 'card-id', 'dest-list-id')
client.cards.vault('board-id', 'card-id')
client.cards.restore('board-id', 'card-id', options)
client.cards.find('board-id', predicate)

client.vault.list('board-id')
client.vault.purge('board-id', 'card-id')

client.plugin.getBoard('board-id')
client.plugin.getAccessLevel()
client.plugin.toggleChecklistItem('board-id', 'card-id', 'item-id')
```

## Revision-safe writes

All write methods fetch the current board revision automatically and retry on
`409 revision_conflict`. Concurrent writes to the same board are serialised through
a per-board promise queue.

For custom write logic use `withFreshRevision`:

```ts
await client.withFreshRevision('board-id', async ({ revision, board }) => {
  await client.updateCard('board-id', 'card-id', { title: 'New', revision });
});
```

## Custom fields

```ts
const value = await client.getCustomField('board-id', 'card-id', 'discord-id');
const all   = await client.getCustomFields('board-id', 'card-id');

// Merge — all other fields are preserved
await client.setCustomField('board-id', 'card-id', 'discord-id', '12345');
await client.setCustomFields('board-id', 'card-id', { key1: 'a', key2: 'b' });
```

## Card search helpers

```ts
import { findCard } from '@yeetgodpro1324/jokelboard-ts';
import type { CardMatch } from '@yeetgodpro1324/jokelboard-ts';

// Synchronous helper — works on any Board object
const match: CardMatch | null = findCard(board, card => card.fieldValues?.['id'] === '42');

// Async — fetches board then searches
const match = await client.findCard('board-id', c => c.title.includes('bug'));
const match = await client.findCardByTitle('board-id', 'My task'); // case-insensitive
const match = await client.findCardById('board-id', 'card-id');
const card  = await client.getCard('board-id', 'card-id');         // throws if not found
```

## Error handling

```ts
import {
  JokelboardError,
  JokelboardConfigurationError,
  RateLimitError,
  RevisionConflictError,
} from '@yeetgodpro1324/jokelboard-ts';

try {
  await client.createCard('board-id', 'list-id', 'My card');
} catch (err) {
  if (err instanceof RateLimitError) {
    console.log('Retry after', err.retryAfter, 'seconds');
  } else if (err instanceof RevisionConflictError) {
    console.log('Server revision:', err.currentRevision);
  } else if (err instanceof JokelboardConfigurationError) {
    console.log('Config error:', err.message);
  } else if (err instanceof JokelboardError) {
    console.log(err.code, err.status, err.method, err.path, err.retryable);
  }
}
```

All errors share:

| Property | Type | Description |
|----------|------|-------------|
| `code` | `string` | Machine-readable error code |
| `status` | `number \| null` | HTTP status, or `null` for network errors |
| `method` | `string \| null` | HTTP method of the failing request |
| `path` | `string \| null` | API path of the failing request |
| `retryable` | `boolean` | `true` for 429, 5xx, network, and revision-conflict |
| `toJSON()` | `ErrorJSON` | Serialisable snapshot |

## Key types

```ts
import type {
  Board, BoardCard, BoardList, BoardData, BoardSummary,
  CardMatch, PatchCardFn, WithFreshRevisionContext,
  ClientOptions, CreateCardOptions, UpdateCardFields,
  AddCommentOptions, MoveCardOptions, RestoreCardOptions,
  JokelboardError, RateLimitError, RevisionConflictError,
} from '@yeetgodpro1324/jokelboard-ts';
```

## Full method reference

| Method | Returns | Description |
|--------|---------|-------------|
| `getMe()` | `Promise<{user, token}>` | Current user and token |
| `listBoards()` | `Promise<BoardSummary[]>` | All accessible boards |
| `getBoard(boardId?)` | `Promise<Board>` | Full board with data |
| `getLists(boardId?)` | `Promise<BoardList[]>` | All lists |
| `replaceBoard(boardId, data, revision?)` | `Promise<Board>` | Replace board data |
| `createList(boardId, title)` | `Promise<object>` | Create a list |
| `createCard(boardId, listId, title, opts?)` | `Promise<CreatedCard>` | Create a card |
| `updateCard(boardId, cardId, fields)` | `Promise<BoardCard>` | Simple PATCH |
| `patchCard(boardId, cardId, patchOrFn)` | `Promise<BoardCard>` | Revision-safe PATCH |
| `getCard(boardId, cardId)` | `Promise<BoardCard>` | Find by ID, throws if missing |
| `findCard(boardId, predicate)` | `Promise<CardMatch \| null>` | Predicate search |
| `findCardByTitle(boardId, title)` | `Promise<CardMatch \| null>` | Case-insensitive title |
| `findCardById(boardId, cardId)` | `Promise<CardMatch \| null>` | ID search, null if missing |
| `addComment(boardId, cardId, text, opts?)` | `Promise<void>` | Add comment |
| `moveCard(boardId, cardId, toListId, opts?)` | `Promise<void>` | Move to list |
| `getCardLink(boardId, cardId)` | `Promise<string>` | Shareable URL |
| `getCustomField(boardId, cardId, key)` | `Promise<string \| null>` | Read one field |
| `getCustomFields(boardId, cardId)` | `Promise<Record<string,string>>` | Read all fields |
| `setCustomField(boardId, cardId, key, value)` | `Promise<BoardCard>` | Write one field |
| `setCustomFields(boardId, cardId, fields)` | `Promise<BoardCard>` | Write many fields |
| `vaultCard(boardId, cardId)` | `Promise<void>` | Archive a card |
| `restoreCard(boardId, cardId, opts?)` | `Promise<void>` | Restore from vault |
| `getVault(boardId)` | `Promise<VaultEntry[]>` | List vaulted cards |
| `purgeCard(boardId, cardId, revision?)` | `Promise<void>` | Permanently delete |
| `withFreshRevision(boardId, fn, opts?)` | `Promise<unknown>` | Custom revision-safe write |
| `resolveBoardId(boardId?)` | `string` | Fallback to defaultBoardId |
| `board(boardId?)` | `BoardClient` | Board-scoped proxy |
| `listBoardTokens(boardId)` | `Promise<Token[]>` | List board tokens |
| `createBoardToken(boardId, name, type)` | `Promise<Token>` | Create board token |
| `deleteBoardToken(boardId, tokenId)` | `Promise<void>` | Delete board token |
| `listProfileTokens()` | `Promise<Token[]>` | List profile tokens |
| `createProfileToken(name)` | `Promise<Token>` | Create profile token |
| `deleteProfileToken(tokenId)` | `Promise<void>` | Delete profile token |
| `listOrgTokens(orgId)` | `Promise<Token[]>` | List org tokens |
| `createOrgToken(orgId, name)` | `Promise<Token>` | Create org token |
| `deleteOrgToken(orgId, tokenId)` | `Promise<void>` | Delete org token |
| `configureOrgBotToken(orgId, tokenId, cfg)` | `Promise<Token>` | Set bot name/avatar |
