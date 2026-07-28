# API Reference

Method names follow each language's convention:
- TypeScript/JS: `camelCase`
- Python: `snake_case`

---

## Me

### `getMe()` / `get_me()`
Returns token owner and metadata.

---

## Boards

### `listBoards()` / `list_boards()`
Returns all boards reachable by the token.

### `getBoard(boardId)` / `get_board(board_id)`
Fetches a single board including its full data (lists, cards, presets).

### `replaceBoard(boardId, data, revision?)` / `replace_board(board_id, data, revision=None)`
Replaces the entire board data object. Optionally pass the current `revision` to guard against concurrent writes.

---

## Lists

### `createList(boardId, title, options?)` / `create_list(board_id, title, *, id=None, revision=None)`
Creates a new list at the end of the board.

| Option | Type | Description |
|--------|------|-------------|
| `id` | string | Custom list ID (optional) |
| `revision` | number | Optimistic concurrency guard |

---

## Cards

### `createCard(boardId, listId, title, options?)` / `create_card(...)`
Creates a card. Returns `{ id, ticket, createdAt, title, categoryId }`.

| Option | Type | Description |
|--------|------|-------------|
| `categoryId` | string | Priority category (e.g. `P1`) |
| `description` | string | Card description (max 8,000 chars) |
| `descriptionMode` | `plain` \| `markdown` \| `fields` | |
| `descriptionSize` | `small` \| `normal` \| `large` | |
| `labels` | Label[] | Up to 50 labels per card |
| `assignees` | string[] | Roblox user IDs |
| `due` | `{ iso: string }` | Due date in ISO 8601 |
| `checklist` | `{ items: [...] }` | Up to 200 checklist items |
| `attachments` | `{ name, url }[]` | Up to 100 attachments |
| `revision` | number | |

### `updateCard(boardId, cardId, fields)` / `update_card(board_id, card_id, fields)`
Partially update a card. Only include fields you want to change. Pass `null` to clear optional fields.

**Setting custom field values:**
```ts
await client.updateCard('board-id', 'card-id', {
  fieldValues: { 'owner-team': 'platform', 'discord-id': '1234567890' },
});
```

### `moveCard(boardId, cardId, toListId, options?)` / `move_card(...)`
Move a card to another list or reorder within the current list.

| Option | Type | Description |
|--------|------|-------------|
| `position` | number | 0 = top, omit = bottom |
| `revision` | number | |

### `getCardLink(boardId, cardId)` / `get_card_link(board_id, card_id)`
Returns the shareable web URL for a card.

### `addComment(boardId, cardId, text, options?)` / `add_comment(...)`
Adds a comment. Regular comments cap at 3,000 chars; pass `kind: 'docucomment'` for up to 15,000 chars.

---

## Vault

### `getVault(boardId)` / `get_vault(board_id)`
Lists soft-deleted cards grouped by source list.

### `vaultCard(boardId, cardId, revision?)` / `vault_card(...)`
Soft-deletes a card into the vault.

### `restoreCard(boardId, cardId, options?)` / `restore_card(...)`
Restores a vaulted card.

| Option | Type | Description |
|--------|------|-------------|
| `toListId` | string | Destination list (defaults to source list) |
| `position` | number | Position in the list |
| `revision` | number | |

### `purgeCard(boardId, cardId, revision?)` / `purge_card(...)`
**Permanently deletes** a vaulted card. This action is irreversible.

---

## Tokens

### Board tokens
- `listBoardTokens(boardId)` / `list_board_tokens(board_id)`
- `createBoardToken(boardId, name, type)` / `create_board_token(board_id, name, type)` — `type`: `programmatic` | `plugin`
- `deleteBoardToken(boardId, tokenId)` / `delete_board_token(board_id, token_id)`

### Profile tokens
- `listProfileTokens()` / `list_profile_tokens()`
- `createProfileToken(name)` / `create_profile_token(name)`
- `deleteProfileToken(tokenId)` / `delete_profile_token(token_id)`

### Org tokens
- `listOrgTokens(orgId)` / `list_org_tokens(org_id)`
- `createOrgToken(orgId, name)` / `create_org_token(org_id, name)`
- `deleteOrgToken(orgId, tokenId)` / `delete_org_token(org_id, token_id)`
- `configureOrgBotToken(orgId, tokenId, config)` / `configure_org_bot_token(org_id, token_id, *, name, avatar)`

Bot config:
- `name` — display name (max 32 chars), pass `null` to remove bot identity
- `avatar` — WebP data URL (max 16 KiB), pass `null` to remove avatar only

---

## Plugin API (`client.plugin`)

Requires a token with `plugin:checklist` scope. Org-owned tokens are not supported.

### `plugin.getBoard(boardId)` / `plugin.get_board(board_id)`
Returns board/list/card/checklist structure only.

### `plugin.toggleChecklistItem(boardId, cardId, itemId)` / `plugin.toggle_checklist_item(...)`
Toggles a checklist item's done state.

### `plugin.getAccessLevel()` / `plugin.get_access_level()`
Probes the plugin access level for the current token.

---

## Client options

| Option | TypeScript/JS | Python | Default |
|--------|--------------|--------|---------|
| API token | `token` | `token` | required |
| Base URL | `baseUrl` | `base_url` | `https://api.jokelboard.com/api/v1` |
| Timeout | `timeout` (ms) | `timeout` (seconds) | 10s |
| Auto-retry on 429 | `retryOnRateLimit` | `retry_on_rate_limit` | `true` |
| Max retries | `maxRetries` | `max_retries` | `3` |
