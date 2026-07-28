# jokelboard (Python)

Python client for the [Jokelboard](https://jokelboard.com) API. Typed with `TypedDict`, auto-retry on rate limits, context manager support.

## Install

```bash
pip install jokelboard
```

Requires Python 3.10+ and `httpx`.

## Usage

```python
import os
from jokelboard import JokelboardClient

with JokelboardClient(token=os.environ["JOKELBOARD_TOKEN"]) as client:
    boards = client.list_boards()

    card = client.create_card(
        "board-id",
        "list-id",
        "Fix login redirect",
        category_id="P1",
        labels=[{"name": "bug", "color": "#ff5e5e"}],
    )

    client.update_card("board-id", card["id"], {
        "fieldValues": {"discord-id": "123456789"},
    })

    client.add_comment("board-id", card["id"], "On it.")
    client.move_card("board-id", card["id"], "done-list-id")

    link = client.get_card_link("board-id", card["id"])
    print(link["url"])
```

## Error handling

```python
from jokelboard import JokelboardError, RateLimitError, RevisionConflictError

try:
    client.create_card(...)
except RateLimitError as e:
    print(f"Rate limited — retry in {e.retry_after}s")
except RevisionConflictError as e:
    print(f"Conflict — current revision: {e.current_revision}")
except JokelboardError as e:
    print(f"{e.code} ({e.status}): {e}")
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `token` | `str` | required | API token (`jkb_...`) |
| `base_url` | `str` | `https://api.jokelboard.com/api/v1` | Override base URL |
| `timeout` | `float` | `10.0` | Timeout in seconds |
| `retry_on_rate_limit` | `bool` | `True` | Auto-retry on 429 |
| `max_retries` | `int` | `3` | Max retry attempts |

See the [full API reference](../../docs/api-reference.md) and [examples](../../docs/examples/basic.py).
