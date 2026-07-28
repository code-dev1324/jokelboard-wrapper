# Authentication

Jokelboard uses bearer tokens with the prefix `jkb_`. There are three token kinds, each with a different reach:

| Kind | Reach | Created in |
|------|-------|------------|
| `board` | Single board only | Board → Automations menu |
| `profile` | Your personal boards | User Settings → Security → API Keys |
| `org` | All boards in an organisation | Organisation admin → API Keys |

## Scopes

| Scope | Allows |
|-------|--------|
| `boards:read` | GET requests — list boards, read board data |
| `boards:write` | Everything in `boards:read` plus mutations (create, patch, comment, move) |
| `plugin:checklist` | Plugin API only — checklist surface |

## Usage

Pass your token when constructing the client:

**TypeScript / JavaScript**
```ts
import { JokelboardClient } from '@jokelboard/typescript';

const client = new JokelboardClient({ token: process.env.JOKELBOARD_TOKEN! });
```

**Python**
```python
import os
from jokelboard import JokelboardClient

client = JokelboardClient(token=os.environ["JOKELBOARD_TOKEN"])
```

## Security

- Never hardcode tokens — use environment variables or a secrets manager.
- Use the narrowest token kind for the job (board key over org key when possible).
- Rotate tokens if they are ever exposed.
- Monitor `last_used_at` via `getMe()` to detect unexpected usage.
