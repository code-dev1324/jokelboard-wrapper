# Error Handling

All three packages expose the same three error classes.

## Error classes

### `JokelboardError`
Base class for all API errors. Always has:
- `code` — machine-readable error code from the API (e.g. `card_not_found`)
- `status` — HTTP status code
- `message` — human-readable message
- `raw` — raw response body

### `RateLimitError` extends `JokelboardError`
Thrown when the API returns `429`. Only thrown after all retries are exhausted (retry is on by default).

Additional properties:
- `retryAfter` — seconds to wait before retrying
- `limit` — burst limit (default: 10 cards per 5 seconds)
- `windowMs` — rate limit window in milliseconds

### `RevisionConflictError` extends `JokelboardError`
Thrown on `409 revision_conflict` — the board was updated after the revision you supplied.

Additional properties:
- `currentRevision` — the board's current revision timestamp; use this to retry

## TypeScript / JavaScript

```ts
import {
  JokelboardClient,
  JokelboardError,
  RateLimitError,
  RevisionConflictError,
} from '@jokelboard/typescript';

const client = new JokelboardClient({ token: 'jkb_...' });

try {
  await client.createCard('board-id', 'list-id', 'My card');
} catch (err) {
  if (err instanceof RateLimitError) {
    console.error(`Rate limited — retry in ${err.retryAfter}s`);
  } else if (err instanceof RevisionConflictError) {
    // Re-fetch the board to get the latest revision, then retry
    console.error(`Conflict — current revision: ${err.currentRevision}`);
  } else if (err instanceof JokelboardError) {
    console.error(`${err.code} (${err.status}): ${err.message}`);
  }
}
```

## Python

```python
from jokelboard import JokelboardClient, JokelboardError, RateLimitError, RevisionConflictError

client = JokelboardClient(token="jkb_...")

try:
    client.create_card("board-id", "list-id", "My card")
except RateLimitError as e:
    print(f"Rate limited — retry in {e.retry_after}s")
except RevisionConflictError as e:
    # Re-fetch the board to get the latest revision, then retry
    print(f"Conflict — current revision: {e.current_revision}")
except JokelboardError as e:
    print(f"{e.code} ({e.status}): {e}")
```

## Automatic retry

By default, `RateLimitError` is never raised unless you've exceeded `maxRetries` (default: 3) — the client waits the `retryAfter` delay and retries automatically.

To disable this:

```ts
// TypeScript / JavaScript
const client = new JokelboardClient({ token: 'jkb_...', retryOnRateLimit: false });
```

```python
# Python
client = JokelboardClient(token="jkb_...", retry_on_rate_limit=False)
```

## Error codes

| Code | Status | Meaning |
|------|--------|---------|
| `api_token_required` | 401 | No bearer token provided |
| `invalid_api_token` | 401 | Token is bad, unknown, or revoked |
| `api_scope_required` | 403 | Token missing required scope |
| `board_scope_violation` | 403 | Board token used on a different board |
| `forbidden` | 403 | No access to the board |
| `vault_access_required` | 403 | Token lacks vault access |
| `not_found` | 404 | Board not found |
| `card_not_found` | 404 | Card not found |
| `revision_conflict` | 409 | Stale revision supplied |
| `card_rate_limited` | 429 | Burst limit exceeded |
