# @yeetgodpro1324/jokelboard-js

JavaScript client for the [Jokelboard](https://jokelboard.com) API. Pure ESM, zero dependencies, no build step.

## Installation

```bash
npm install @yeetgodpro1324/jokelboard-js
```

## Quick start

```js
import { JokelboardClient } from '@yeetgodpro1324/jokelboard-js';

const client = new JokelboardClient({ token: process.env.JKB_TOKEN });

const boards = await client.listBoards();
const b = client.board('my-board-id');
const lists = await b.getLists();
const match = await b.cards.findByTitle('Fix the bug');
```

## Constructor options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `token` | `string` | required | API token — must start with `jkb_` |
| `defaultBoardId` | `string\|null` | `null` | Fallback board ID when none is passed |
| `baseUrl` | `string` | Jokelboard API | Override base URL (HTTPS required) |
| `timeout` | `number` | `10000` | Request timeout in ms |
| `retryOnRateLimit` | `boolean` | `true` | Auto-retry on 429 responses |
| `maxRetries` | `number` | `3` | Max 429 retry attempts |
| `maxConflictRetries` | `number` | `1` | Max revision-conflict retries |
| `fetchImpl` | `function\|null` | `globalThis.fetch` | Custom fetch (useful for testing) |

## Board proxy

`client.board(boardId?)` returns a `BoardClient` scoped to a board so you never need
to repeat `boardId`. If `defaultBoardId` is set you can call `client.board()` with no
argument.

```js
const b = client.board('board-id');

await b.get();
await b.getLists();
await b.replace(data, revision);
await b.withFreshRevision(async ({ revision, board }) => { /* ... */ });

// Cards namespace
await b.cards.get('card-id');
await b.cards.findByTitle('My task');      // case-insensitive, returns { card, list } | null
await b.cards.findById('card-id');         // returns { card, list } | null
await b.cards.create('list-id', 'Title');
await b.cards.update('card-id', fields);
await b.cards.patch('card-id', { title: 'Updated' });
await b.cards.patch('card-id', card => ({ title: card.title + ' ✓' }));
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

```js
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

All write methods (`patchCard`, `createCard`, `moveCard`, `vaultCard`, etc.) fetch the
current board revision automatically and retry once on `409 revision_conflict`. Concurrent
writes to the same board are serialised through a per-board promise queue.

For custom write logic use `withFreshRevision`:

```js
await client.withFreshRevision('board-id', async ({ revision, board, boardClient }) => {
  await client.updateCard('board-id', 'card-id', { title: 'New', revision });
});
```

## Custom fields

```js
const value = await client.getCustomField('board-id', 'card-id', 'discord-id');
const all   = await client.getCustomFields('board-id', 'card-id');

// Writes merge — other fields are preserved
await client.setCustomField('board-id', 'card-id', 'discord-id', '12345');
await client.setCustomFields('board-id', 'card-id', { key1: 'a', key2: 'b' });
```

## Card search helpers

```js
import { findCard } from '@yeetgodpro1324/jokelboard-js';

// Synchronous helper — works on any board object you already have
const match = findCard(board, card => card.fieldValues?.['discord-id'] === '999');

// Async — fetches board then searches
const match = await client.findCard('board-id', c => c.title.includes('bug'));
const match = await client.findCardByTitle('board-id', 'My task'); // case-insensitive
const match = await client.findCardById('board-id', 'card-id');   // null if not found
const card  = await client.getCard('board-id', 'card-id');        // throws if not found
```

## Error handling

```js
import {
  JokelboardError,
  JokelboardConfigurationError,
  RateLimitError,
  RevisionConflictError,
} from '@yeetgodpro1324/jokelboard-js';

try {
  await client.createCard('board-id', 'list-id', 'My card');
} catch (err) {
  if (err instanceof RateLimitError) {
    console.log('Retry after', err.retryAfter, 'seconds');
  } else if (err instanceof RevisionConflictError) {
    console.log('Current server revision:', err.currentRevision);
  } else if (err instanceof JokelboardConfigurationError) {
    console.log('Configuration error:', err.message);
  } else if (err instanceof JokelboardError) {
    console.log(err.code, err.status, err.method, err.path, err.retryable);
    console.log(err.toJSON()); // serialisable snapshot
  }
}
```

| Property | Type | Description |
|----------|------|-------------|
| `err.code` | `string` | Machine-readable error code |
| `err.status` | `number\|null` | HTTP status, or `null` for network errors |
| `err.method` | `string\|null` | HTTP method of the failing request |
| `err.path` | `string\|null` | API path of the failing request |
| `err.retryable` | `boolean` | `true` for 429, 5xx, network, and revision-conflict |
| `err.toJSON()` | `object` | Serialisable snapshot |

## Full method reference

| Method | Returns | Description |
|--------|---------|-------------|
| `getMe()` | `Promise<{user, token}>` | Current user and token info |
| `listBoards()` | `Promise<object[]>` | All accessible boards |
| `getBoard(boardId?)` | `Promise<object>` | Full board with data |
| `getLists(boardId?)` | `Promise<object[]>` | All lists on a board |
| `replaceBoard(boardId, data, revision?)` | `Promise<object>` | Replace board data |
| `createList(boardId, title)` | `Promise<object>` | Create a list |
| `createCard(boardId, listId, title, options?)` | `Promise<object>` | Create a card |
| `updateCard(boardId, cardId, fields)` | `Promise<object>` | Simple PATCH (manual revision) |
| `patchCard(boardId, cardId, patchOrFn)` | `Promise<object>` | Revision-safe PATCH |
| `getCard(boardId, cardId)` | `Promise<object>` | Find card by ID, throws if missing |
| `findCard(boardId, predicate)` | `Promise<match\|null>` | Predicate search |
| `findCardByTitle(boardId, title)` | `Promise<match\|null>` | Case-insensitive title search |
| `findCardById(boardId, cardId)` | `Promise<match\|null>` | ID search, returns null |
| `addComment(boardId, cardId, text, options?)` | `Promise<void>` | Add comment |
| `moveCard(boardId, cardId, toListId, options?)` | `Promise<void>` | Move to list |
| `getCardLink(boardId, cardId)` | `Promise<string>` | Shareable card URL |
| `getCustomField(boardId, cardId, key)` | `Promise<string\|null>` | Read one field |
| `getCustomFields(boardId, cardId)` | `Promise<Record<string,string>>` | Read all fields |
| `setCustomField(boardId, cardId, key, value)` | `Promise<object>` | Write one field |
| `setCustomFields(boardId, cardId, fields)` | `Promise<object>` | Write multiple fields |
| `vaultCard(boardId, cardId)` | `Promise<void>` | Archive a card |
| `restoreCard(boardId, cardId, options?)` | `Promise<void>` | Restore from vault |
| `getVault(boardId)` | `Promise<object[]>` | List vaulted cards |
| `purgeCard(boardId, cardId, revision?)` | `Promise<void>` | Permanently delete |
| `withFreshRevision(boardId, fn, opts?)` | `Promise<any>` | Custom revision-safe write |
| `resolveBoardId(boardId?)` | `string` | Resolve with defaultBoardId fallback |
| `board(boardId?)` | `BoardClient` | Board-scoped proxy |
| `listBoardTokens(boardId)` | `Promise<object[]>` | List board tokens |
| `createBoardToken(boardId, name, type)` | `Promise<object>` | Create board token |
| `deleteBoardToken(boardId, tokenId)` | `Promise<void>` | Delete board token |
| `listProfileTokens()` | `Promise<object[]>` | List profile tokens |
| `createProfileToken(name)` | `Promise<object>` | Create profile token |
| `deleteProfileToken(tokenId)` | `Promise<void>` | Delete profile token |
| `listOrgTokens(orgId)` | `Promise<object[]>` | List org tokens |
| `createOrgToken(orgId, name)` | `Promise<object>` | Create org token |
| `deleteOrgToken(orgId, tokenId)` | `Promise<void>` | Delete org token |
| `configureOrgBotToken(orgId, tokenId, config)` | `Promise<object>` | Set bot name/avatar |
