# jokelboard (Python)

Python client for the [Jokelboard](https://jokelboard.com) API. Typed with `TypedDict`, auto-retry on rate limits, context manager support.

## Installation

```bash
pip install jokelboard
```

## Quick start

```python
from jokelboard import JokelboardClient

with JokelboardClient(token="jkb_...") as client:
    boards = client.list_boards()
    b = client.board("my-board-id")
    lists = b.get_lists()
    match = b.find_card_by_title("Fix the bug")
```

## Constructor options

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `token` | `str` | required | API token — must start with `jkb_` |
| `default_board_id` | `str \| None` | `None` | Fallback board ID when none is passed |
| `base_url` | `str` | Jokelboard API | Override base URL (HTTPS required) |
| `timeout` | `float` | `10.0` | Request timeout in seconds |
| `retry_on_rate_limit` | `bool` | `True` | Auto-retry on 429 responses |
| `max_retries` | `int` | `3` | Max 429 retry attempts |
| `max_conflict_retries` | `int` | `1` | Max revision-conflict retries |
| `http_client` | `httpx.Client \| None` | auto | Custom httpx client (useful for testing) |

## Board proxy

`client.board(board_id?)` returns a `BoardClient` scoped to one board so you never
need to pass `board_id` on every call. If `default_board_id` is set you can call
`client.board()` with no argument.

```python
b = client.board("board-id")

# Board
b.get()
b.get_lists()
b.replace(data, revision)
b.with_fresh_revision(lambda ctx: ...)

# Cards — all revision-safe
b.get_card("card-id")                        # raises if not found
b.find_card(lambda card, lst: ...)           # CardMatch | None
b.find_card_by_title("My task")              # case-insensitive
b.find_card_by_id("card-id")
b.create_card("list-id", "Title")
b.update_card("card-id", {"title": "New"})   # manual revision
b.patch_card("card-id", {"title": "New"})    # auto revision
b.patch_card("card-id", lambda card, lst, board: {"title": card["title"] + " ✓"})
b.add_comment("card-id", "Hello")
b.move_card("card-id", "dest-list-id")
b.vault_card("card-id")
b.restore_card("card-id", to_list_id="list-id")
b.get_card_link("card-id")

# Custom fields
b.get_custom_field("card-id", "discord-id")
b.get_custom_fields("card-id")
b.set_custom_field("card-id", "discord-id", "12345")
b.set_custom_fields("card-id", {"key1": "a", "key2": "b"})

# Vault
b.get_vault()
b.purge_card("card-id")

# Lists
b.create_list("List title")

# Plugin
b.plugin_get()
b.plugin_toggle_checklist_item("card-id", "item-id")
```

## Revision-safe writes

All write methods (`patch_card`, `create_card`, `move_card`, `vault_card`, etc.) fetch
the current board revision automatically and retry on `RevisionConflictError`. Concurrent
writes to the same board from different threads are serialised via a per-board lock.

For custom write logic use `with_fresh_revision`:

```python
def my_op(ctx):
    client.update_card("board-id", "card-id", {"title": "New", "revision": ctx.revision})

client.with_fresh_revision("board-id", my_op)
```

The context object exposes `revision`, `board`, `board_client`, and `attempt`.

## Custom fields

```python
value = client.get_custom_field("board-id", "card-id", "discord-id")
all_fields = client.get_custom_fields("board-id", "card-id")

# Writes merge — other existing fields are preserved
client.set_custom_field("board-id", "card-id", "discord-id", "12345")
client.set_custom_fields("board-id", "card-id", {"key1": "a", "key2": "b"})
```

## Card search helpers

```python
from jokelboard import find_card

# Synchronous helper — works on any Board dict you already have
match = find_card(board, lambda card, lst: card.get("fieldValues", {}).get("id") == "42")

# Async-style — fetches board then searches
match = client.find_card("board-id", lambda card, lst: "bug" in card.get("title", ""))
match = client.find_card_by_title("board-id", "My task")  # case-insensitive
match = client.find_card_by_id("board-id", "card-id")    # None if not found
card  = client.get_card("board-id", "card-id")            # raises if not found
```

## Error handling

```python
from jokelboard import (
    JokelboardError,
    JokelboardConfigurationError,
    RateLimitError,
    RevisionConflictError,
)

try:
    client.create_card("board-id", "list-id", "My card")
except RateLimitError as e:
    print(f"Retry after {e.retry_after}s")
except RevisionConflictError as e:
    print(f"Current server revision: {e.current_revision}")
except JokelboardConfigurationError as e:
    print(f"Config error: {e}")
except JokelboardError as e:
    print(e.code, e.status, e.method, e.path, e.retryable)
    print(e.to_dict())
```

All errors expose:

| Attribute | Type | Description |
|-----------|------|-------------|
| `code` | `str` | Machine-readable error code |
| `status` | `int \| None` | HTTP status, or `None` for network errors |
| `method` | `str \| None` | HTTP method of the failing request |
| `path` | `str \| None` | API path of the failing request |
| `retryable` | `bool` | `True` for 429, 5xx, network, and revision-conflict |
| `to_dict()` | `dict` | Serialisable snapshot |

## Full method reference

| Method | Returns | Description |
|--------|---------|-------------|
| `get_me()` | `dict` | Current user and token |
| `list_boards()` | `list[BoardSummary]` | All accessible boards |
| `get_board(board_id?)` | `Board` | Full board with data |
| `get_lists(board_id?)` | `list[BoardList]` | All lists |
| `replace_board(board_id, data, revision?)` | `Board` | Replace board data |
| `create_list(board_id, title)` | `dict` | Create a list |
| `create_card(board_id, list_id, title, **kwargs)` | `dict` | Create a card |
| `update_card(board_id, card_id, fields)` | `BoardCard` | Simple PATCH (manual revision) |
| `patch_card(board_id, card_id, patch)` | `BoardCard` | Revision-safe PATCH |
| `get_card(board_id, card_id)` | `BoardCard` | Find by ID, raises if missing |
| `find_card(board_id, predicate)` | `CardMatch \| None` | Predicate search |
| `find_card_by_title(board_id, title)` | `CardMatch \| None` | Case-insensitive title |
| `find_card_by_id(board_id, card_id)` | `CardMatch \| None` | ID search, None if missing |
| `add_comment(board_id, card_id, text, *, kind?)` | `None` | Add comment |
| `move_card(board_id, card_id, to_list_id, *, position?)` | `None` | Move to list |
| `get_card_link(board_id, card_id)` | `str` | Shareable URL |
| `get_custom_field(board_id, card_id, key)` | `str \| None` | Read one field |
| `get_custom_fields(board_id, card_id)` | `dict[str, str]` | Read all fields |
| `set_custom_field(board_id, card_id, key, value)` | `BoardCard` | Write one field |
| `set_custom_fields(board_id, card_id, fields)` | `BoardCard` | Write many fields |
| `vault_card(board_id, card_id)` | `None` | Archive a card |
| `restore_card(board_id, card_id, *, to_list_id?, position?)` | `None` | Restore from vault |
| `get_vault(board_id?)` | `list[VaultEntry]` | List vaulted cards |
| `purge_card(board_id, card_id, revision?)` | `None` | Permanently delete |
| `with_fresh_revision(board_id, fn, *, retries?)` | `Any` | Custom revision-safe write |
| `resolve_board_id(board_id?)` | `str` | Fallback to default_board_id |
| `board(board_id?)` | `BoardClient` | Board-scoped proxy |
| `list_board_tokens(board_id)` | `list[Token]` | List board tokens |
| `create_board_token(board_id, name, type)` | `Token` | Create board token |
| `delete_board_token(board_id, token_id)` | `None` | Delete board token |
| `list_profile_tokens()` | `list[Token]` | List profile tokens |
| `create_profile_token(name)` | `Token` | Create profile token |
| `delete_profile_token(token_id)` | `None` | Delete profile token |
| `list_org_tokens(org_id)` | `list[Token]` | List org tokens |
| `create_org_token(org_id, name)` | `Token` | Create org token |
| `delete_org_token(org_id, token_id)` | `None` | Delete org token |
| `configure_org_bot_token(org_id, token_id, *, name?, avatar?)` | `Token` | Set bot name/avatar |
