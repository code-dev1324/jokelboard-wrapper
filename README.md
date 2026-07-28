# jokelboard-wrapper

Unofficial API wrappers for [Jokelboard](https://jokelboard.com), available in JavaScript, TypeScript, and Python.

## Packages

| Package | Language | Install |
|---------|----------|---------|
| [`packages/typescript`](./packages/typescript) | TypeScript (strict, ESM + CJS) | `npm install @jokelboard/typescript` |
| [`packages/js`](./packages/js) | JavaScript (ESM, no build step) | `npm install @jokelboard/js` |
| [`packages/python`](./packages/python) | Python 3.10+ | `pip install jokelboard` |

## Quick start

**TypeScript / JavaScript**
```ts
import { JokelboardClient } from '@jokelboard/typescript';

const client = new JokelboardClient({ token: 'jkb_...' });

const boards = await client.listBoards();
const card = await client.createCard('board-id', 'list-id', 'My card');
await client.addComment('board-id', card.id, 'Hello!');
```

**Python**
```python
from jokelboard import JokelboardClient

with JokelboardClient(token="jkb_...") as client:
    boards = client.list_boards()
    card = client.create_card("board-id", "list-id", "My card")
    client.add_comment("board-id", card["id"], "Hello!")
```

## Documentation

- [Authentication](./docs/authentication.md)
- [Error handling](./docs/error-handling.md)
- [API reference](./docs/api-reference.md)
- [Examples](./docs/examples/)

## API coverage

| Feature | Supported |
|---------|-----------|
| Boards (list, get, replace) | ✅ |
| Lists (create) | ✅ |
| Cards (create, update, move, link, comment) | ✅ |
| Vault (list, vault, restore, purge) | ✅ |
| Board tokens | ✅ |
| Profile tokens | ✅ |
| Org tokens + bot config | ✅ |
| Plugin API (checklist) | ✅ |
| Auto-retry on rate limit | ✅ |
| Revision conflict error | ✅ |

## License

MIT
