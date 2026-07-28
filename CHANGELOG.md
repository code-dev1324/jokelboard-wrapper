# Changelog

All notable changes to packages in this monorepo are documented here.

---

## @yeetgodpro1324/jokelboard-js

### 1.4.0

- Added `BoardClient` proxy returned by `client.board(boardId?)`
- Added `client.board().getLists()` convenience method
- Added `client.board().cards.get()`, `.findByTitle()`, `.findById()`
- Added namespaced frozen APIs: `client.boards`, `client.lists`, `client.cards`, `client.vault`, `client.plugin`
- Added `getLists()`, `getCard()`, `findCardByTitle()`, `findCardById()` on main client
- Added `getCustomField()`, `getCustomFields()`, `setCustomField()`, `setCustomFields()`
- Added `withFreshRevision()` public API with `boardClient` context
- Added `resolveBoardId()` with `defaultBoardId` fallback
- Added `findCard` as a named export for synchronous board traversal
- `plugin` is now a frozen plain object (was a `PluginClient` instance)
- `vaultCard` and `restoreCard` now go through the write queue and revision loop
- Errors enriched with `method`, `path`, `retryable`, `toJSON()` on all error classes
- Added `JokelboardConfigurationError` distinct from `JokelboardError`
- Token is stripped from all error `.raw` bodies via recursive redaction
- URL validation: rejects credentials, query strings, hashes, non-HTTPS (localhost exempted)
- `patchCard` accepts a function `(card, list, board) => fields`
- Concurrent writes to the same board are serialised via a per-board promise queue

### 1.3.0

- Added `patchCard` with revision-safe write queue
- Added `_withRevision` internal for all board writes
- Added `RateLimitError`, `RevisionConflictError`
- Auto-retry on 429 with `retryOnRateLimit` option

### 1.2.0

- Added vault methods: `vaultCard`, `restoreCard`, `getVault`, `purgeCard`
- Added board token, profile token, org token management methods

### 1.1.0

- Added `addComment`, `moveCard`, `getCardLink`

### 1.0.0

- Initial release: `listBoards`, `getBoard`, `createCard`, `updateCard`

---

## @yeetgodpro1324/jokelboard-ts

### 1.1.0

- Full rewrite to reach feature parity with JS package 1.4.0
- Added `BoardClient` class with all namespaced frozen sub-APIs
- Added `getLists()`, `getCard()`, `findCardByTitle()`, `findCardById()` on `JokelboardClient`
- Added `getCustomField()`, `getCustomFields()`, `setCustomField()`, `setCustomFields()`
- Added `withFreshRevision()`, `resolveBoardId()`, `board()`
- Added `findCard` named export
- `plugin` is now a frozen plain object on the main client
- `vaultCard` and `restoreCard` go through `_withRevision`
- `JokelboardConfigurationError` added
- All error classes: `method`, `path`, `retryable`, `toJSON()`, token redaction
- New types: `CardMatch`, `PatchCardFn`, `WithFreshRevisionContext`, `BoardClientInterface`
- `ClientOptions` extended: `defaultBoardId`, `maxConflictRetries`, `fetchImpl`
- Removed `revision` from `CreateCardOptions`, `AddCommentOptions`, `MoveCardOptions`
- ESM + CJS dual build via tsup

### 1.0.0

- Initial release: typed wrappers for boards, cards, comments, vault, tokens
