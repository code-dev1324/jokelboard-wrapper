# @jokelboard/js

JavaScript client for the [Jokelboard](https://jokelboard.com) API. Pure ESM, no build step required, JSDoc annotations for IDE type hints.

## Install

```bash
npm install @jokelboard/js
```

Requires Node.js 18+.

## Usage

```js
import { JokelboardClient } from '@jokelboard/js';

const client = new JokelboardClient({ token: process.env.JOKELBOARD_TOKEN });

const boards = await client.listBoards();

const card = await client.createCard('board-id', 'list-id', 'Fix login redirect', {
  categoryId: 'P1',
  labels: [{ name: 'bug', color: '#ff5e5e' }],
});

await client.updateCard('board-id', card.id, {
  fieldValues: { 'discord-id': '123456789' },
});

await client.addComment('board-id', card.id, 'On it.');
await client.moveCard('board-id', card.id, 'done-list-id');
```

## Error handling

```js
import { JokelboardError, RateLimitError, RevisionConflictError } from '@jokelboard/js';

try {
  await client.createCard(...);
} catch (err) {
  if (err instanceof RateLimitError) {
    console.error(`Rate limited — retry in ${err.retryAfter}s`);
  } else if (err instanceof RevisionConflictError) {
    console.error(`Conflict — current revision: ${err.currentRevision}`);
  } else if (err instanceof JokelboardError) {
    console.error(`${err.code} (${err.status}): ${err.message}`);
  }
}
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `token` | `string` | required | API token (`jkb_...`) |
| `baseUrl` | `string` | `https://api.jokelboard.com/api/v1` | Override base URL |
| `timeout` | `number` | `10000` | Timeout in ms |
| `retryOnRateLimit` | `boolean` | `true` | Auto-retry on 429 |
| `maxRetries` | `number` | `3` | Max retry attempts |

Prefer TypeScript? Use [`@jokelboard/typescript`](../typescript) for full static type checking.

See the [full API reference](../../docs/api-reference.md) and [examples](../../docs/examples/basic.js).
