"""Jokelboard API client."""

from __future__ import annotations

import threading
import time
from typing import Any, Callable, Optional, Union
from urllib.parse import urlparse

import httpx

from .errors import JokelboardConfigurationError, JokelboardError, RateLimitError, RevisionConflictError
from .types import (
    Board, BoardCard, BoardData, BoardList, BoardSummary,
    CardLink, CardMatch, PluginBoard, PatchCardFn, Token, VaultEntry,
)

DEFAULT_BASE_URL = "https://api.jokelboard.com/api/v1"
DEFAULT_TIMEOUT = 10.0
DEFAULT_MAX_RETRIES = 3
DEFAULT_MAX_CONFLICT_RETRIES = 1


# ---- Helpers ----

def _normalise_base_url(value: str) -> str:
    try:
        u = urlparse(value or DEFAULT_BASE_URL)
    except Exception:
        raise JokelboardConfigurationError("base_url must be a valid URL.")
    if u.username or u.password:
        raise JokelboardConfigurationError("base_url must not contain credentials.")
    if u.query or u.fragment:
        raise JokelboardConfigurationError("base_url must not contain a query string or fragment.")
    local = {"localhost", "127.0.0.1", "::1"}
    if u.scheme != "https" and not (u.scheme == "http" and u.hostname in local):
        raise JokelboardConfigurationError("base_url must use HTTPS.")
    return value.rstrip("/")


def _require_id(value: Any, name: str) -> str:
    if not isinstance(value, (str, int)) or not str(value).strip():
        raise JokelboardConfigurationError(f"{name} must be a non-empty string or number.")
    return str(value).strip()


def _sanitise_comment(text: str) -> str:
    return text.replace("<", "&lt;").replace(">", "&gt;")


def _redact_token(value: Any, token: str) -> Any:
    if isinstance(value, str):
        return value.replace(token, "[REDACTED]")
    if isinstance(value, list):
        return [_redact_token(v, token) for v in value]
    if isinstance(value, dict):
        return {k: _redact_token(v, token) for k, v in value.items()}
    return value


def find_card(board: Board, predicate: Callable[[BoardCard, BoardList], bool]) -> Optional[CardMatch]:
    """Walk all lists and return the first card matching *predicate*, or ``None``."""
    for lst in (board.get("data") or {}).get("lists", []):
        for card in lst.get("cards") or []:
            if predicate(card, lst):
                return CardMatch(card=card, list=lst)
    return None


# ---- Board-scoped proxy ----

class BoardClient:
    """A ``JokelboardClient`` scoped to a single board — no need to pass ``board_id`` per call."""

    def __init__(self, api: "JokelboardClient", board_id: str) -> None:
        self._api = api
        self.id = board_id

    # Board
    def get(self) -> Board:
        return self._api.get_board(self.id)

    def get_lists(self) -> list[BoardList]:
        return self._api.get_lists(self.id)

    def replace(self, data: BoardData, revision: Optional[int] = None) -> Board:
        return self._api.replace_board(self.id, data, revision)

    def with_fresh_revision(
        self,
        operation: Callable[["_FreshRevisionContext"], Any],
        *,
        retries: Optional[int] = None,
    ) -> Any:
        return self._api.with_fresh_revision(self.id, operation, retries=retries)

    # Cards
    def get_card(self, card_id: str) -> BoardCard:
        return self._api.get_card(self.id, card_id)

    def find_card(self, predicate: Callable[[BoardCard, BoardList], bool]) -> Optional[CardMatch]:
        return self._api.find_card(self.id, predicate)

    def find_card_by_title(self, title: str) -> Optional[CardMatch]:
        return self._api.find_card_by_title(self.id, title)

    def find_card_by_id(self, card_id: str) -> Optional[CardMatch]:
        return self._api.find_card_by_id(self.id, card_id)

    def create_card(self, list_id: str, title: str, **kwargs: Any) -> dict[str, Any]:
        return self._api.create_card(self.id, list_id, title, **kwargs)

    def update_card(self, card_id: str, fields: dict[str, Any]) -> BoardCard:
        return self._api.update_card(self.id, card_id, fields)

    def patch_card(self, card_id: str, patch: Union[dict[str, Any], PatchCardFn]) -> BoardCard:
        return self._api.patch_card(self.id, card_id, patch)

    def add_comment(self, card_id: str, text: str, **kwargs: Any) -> None:
        return self._api.add_comment(self.id, card_id, text, **kwargs)

    def move_card(self, card_id: str, to_list_id: str, **kwargs: Any) -> None:
        return self._api.move_card(self.id, card_id, to_list_id, **kwargs)

    def get_card_link(self, card_id: str) -> CardLink:
        return self._api.get_card_link(self.id, card_id)

    def vault_card(self, card_id: str) -> None:
        return self._api.vault_card(self.id, card_id)

    def restore_card(self, card_id: str, **kwargs: Any) -> None:
        return self._api.restore_card(self.id, card_id, **kwargs)

    # Custom fields
    def get_custom_field(self, card_id: str, field_key: str) -> Optional[str]:
        return self._api.get_custom_field(self.id, card_id, field_key)

    def get_custom_fields(self, card_id: str) -> dict[str, str]:
        return self._api.get_custom_fields(self.id, card_id)

    def set_custom_field(self, card_id: str, field_key: str, value: Any) -> BoardCard:
        return self._api.set_custom_field(self.id, card_id, field_key, value)

    def set_custom_fields(self, card_id: str, fields: dict[str, Any]) -> BoardCard:
        return self._api.set_custom_fields(self.id, card_id, fields)

    # Vault
    def get_vault(self) -> list[VaultEntry]:
        return self._api.get_vault(self.id)

    def purge_card(self, card_id: str, revision: Optional[int] = None) -> None:
        return self._api.purge_card(self.id, card_id, revision)

    # Lists
    def create_list(self, title: str) -> dict[str, Any]:
        return self._api.create_list(self.id, title)

    # Plugin
    def plugin_get(self) -> PluginBoard:
        return self._api.plugin.get_board(self.id)

    def plugin_toggle_checklist_item(self, card_id: str, item_id: str) -> dict[str, Any]:
        return self._api.plugin.toggle_checklist_item(self.id, card_id, item_id)

    def __repr__(self) -> str:
        return f"BoardClient(id={self.id!r})"


class _FreshRevisionContext:
    __slots__ = ("revision", "board", "board_client", "attempt")

    def __init__(self, revision: int, board: Board, board_client: BoardClient, attempt: int) -> None:
        self.revision = revision
        self.board = board
        self.board_client = board_client
        self.attempt = attempt


# ---- Main client ----

class JokelboardClient:
    """
    Synchronous Jokelboard API client.

    Usage::

        with JokelboardClient(token="jkb_...") as client:
            boards = client.list_boards()
            b = client.board("my-board-id")
            lists = b.get_lists()
    """

    def __init__(
        self,
        token: str,
        *,
        default_board_id: Optional[str] = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        retry_on_rate_limit: bool = True,
        max_retries: int = DEFAULT_MAX_RETRIES,
        max_conflict_retries: int = DEFAULT_MAX_CONFLICT_RETRIES,
        http_client: Optional[httpx.Client] = None,
    ) -> None:
        """
        Args:
            token: API token — must start with ``jkb_``.
            default_board_id: Fallback board ID when none is passed to methods.
            base_url: Override the API base URL (HTTPS required).
            timeout: Request timeout in seconds (default 10).
            retry_on_rate_limit: Auto-retry on 429 (default True).
            max_retries: Max 429 retry attempts (default 3).
            max_conflict_retries: Max revision-conflict retries (default 1).
            http_client: Provide your own ``httpx.Client`` for testing.
        """
        t = _require_id(token, "token")
        if not t.startswith("jkb_") or len(t) > 256 or any(c.isspace() for c in t):
            raise JokelboardConfigurationError("token is not a valid Jokelboard API token.")
        self._token = t

        self.default_board_id: Optional[str] = (
            _require_id(default_board_id, "default_board_id") if default_board_id else None
        )
        self._base_url = _normalise_base_url(base_url)
        self._retry_on_rate_limit = retry_on_rate_limit
        self._max_retries = max(0, int(max_retries))
        self._max_conflict_retries = max(0, int(max_conflict_retries))

        self._http = http_client or httpx.Client(
            base_url=self._base_url,
            headers={"Authorization": f"Bearer {t}"},
            timeout=timeout,
        )

        # Per-board locks — serialise concurrent writes per board
        self._write_locks: dict[str, threading.Lock] = {}
        self._write_locks_lock = threading.Lock()

        self.plugin = _PluginClient(self._request)

    def _get_write_lock(self, board_id: str) -> threading.Lock:
        with self._write_locks_lock:
            if board_id not in self._write_locks:
                self._write_locks[board_id] = threading.Lock()
            return self._write_locks[board_id]

    def close(self) -> None:
        """Close the underlying HTTP session."""
        self._http.close()

    def __enter__(self) -> "JokelboardClient":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    # ---- Core HTTP ----

    def _request(self, method: str, path: str, body: Optional[dict[str, Any]] = None, attempt: int = 0) -> Any:
        ctx = {"method": method, "path": path}
        try:
            res = self._http.request(method, path, json=body)
        except httpx.TimeoutException:
            raise JokelboardError("request_timeout", "Request timed out.", None, None, **ctx)
        except Exception as exc:
            raise JokelboardError("network_error", "Unable to reach the Jokelboard API.", None, None, **ctx) from exc

        try:
            data: Any = res.json()
        except Exception:
            data = None

        redacted = _redact_token(data, self._token)

        if res.is_success:
            return data

        if res.status_code == 429:
            retry_after = int((data or {}).get("retryAfter", res.headers.get("retry-after", 1)) or 1)
            if self._retry_on_rate_limit and attempt < self._max_retries:
                time.sleep(retry_after)
                return self._request(method, path, body, attempt + 1)
            raise RateLimitError(
                (data or {}).get("message", "Rate limit exceeded."),
                retry_after,
                redacted,
                **ctx,
            )

        if res.status_code == 409 and (data or {}).get("error") == "revision_conflict":
            raise RevisionConflictError(
                (data or {}).get("message", "Revision conflict."),
                (data or {}).get("currentRevision"),
                redacted,
                **ctx,
            )

        d = data or {}
        raise JokelboardError(
            d.get("error", "http_error"),
            d.get("message", f"HTTP {res.status_code}"),
            res.status_code,
            redacted,
            **ctx,
        )

    # ---- Revision-safe write queue ----

    def _with_revision(self, board_id: str, operation: Callable[[Board, int], Any]) -> Any:
        """Acquire per-board lock, fetch revision, call operation, retry on conflict."""
        lock = self._get_write_lock(board_id)
        with lock:
            for attempt in range(self._max_conflict_retries + 1):
                board = self.get_board(board_id)
                revision = board.get("revision")
                if revision is None:
                    raise JokelboardError("invalid_response", "Board response missing revision.", None, board)
                try:
                    return operation(board, revision)
                except RevisionConflictError:
                    if attempt < self._max_conflict_retries:
                        continue
                    raise

    def with_fresh_revision(
        self,
        board_id: Optional[str],
        operation: Callable[[_FreshRevisionContext], Any],
        *,
        retries: Optional[int] = None,
    ) -> Any:
        """
        Fetch the current board revision then call ``operation(ctx)`` where ``ctx``
        exposes ``revision``, ``board``, ``board_client``, and ``attempt``.
        Retries automatically on revision conflicts.
        """
        if not callable(operation):
            raise JokelboardConfigurationError("operation must be callable.")
        resolved = self.resolve_board_id(board_id)
        board_client = self.board(resolved)
        max_retries = self._max_conflict_retries if retries is None else retries

        def _op(board: Board, revision: int) -> Any:
            ctx = _FreshRevisionContext(revision=revision, board=board, board_client=board_client, attempt=1)
            return operation(ctx)

        original_max = self._max_conflict_retries
        self._max_conflict_retries = max_retries
        try:
            return self._with_revision(resolved, _op)
        finally:
            self._max_conflict_retries = original_max

    def resolve_board_id(self, board_id: Optional[str]) -> str:
        """Return *board_id* if given, else ``default_board_id``. Raises if neither is set."""
        resolved = board_id or self.default_board_id
        if not resolved:
            raise JokelboardConfigurationError(
                "board_id is required. Pass one directly or set default_board_id on the client."
            )
        return _require_id(resolved, "board_id")

    def board(self, board_id: Optional[str] = None) -> BoardClient:
        """Return a :class:`BoardClient` scoped to *board_id* (or ``default_board_id``)."""
        return BoardClient(self, self.resolve_board_id(board_id))

    # ---- Me ----

    def get_me(self) -> dict[str, Any]:
        """Return token owner and metadata."""
        return self._request("GET", "/me")

    # ---- Boards ----

    def list_boards(self) -> list[BoardSummary]:
        """List all boards reachable by the token."""
        return self._request("GET", "/boards")["boards"]

    def get_board(self, board_id: Optional[str] = None) -> Board:
        """Fetch a board with its full data payload."""
        bid = self.resolve_board_id(board_id)
        d = self._request("GET", f"/boards/{bid}")
        if not isinstance(d.get("board", {}).get("data", {}).get("lists"), list):
            raise JokelboardError("invalid_response", "Invalid board response.", None, d)
        return d["board"]

    def get_lists(self, board_id: Optional[str] = None) -> list[BoardList]:
        """Return all lists on a board."""
        return self.get_board(board_id)["data"]["lists"]

    def replace_board(self, board_id: Optional[str], data: BoardData, revision: Optional[int] = None) -> Board:
        """Replace the entire board data object."""
        bid = self.resolve_board_id(board_id)
        body: dict[str, Any] = {"data": data}
        if revision is not None:
            body["revision"] = revision
        return self._request("PUT", f"/boards/{bid}", body)["board"]

    # ---- Card search ----

    def find_card(
        self,
        board_id: Optional[str],
        predicate: Callable[[BoardCard, BoardList], bool],
    ) -> Optional[CardMatch]:
        """Fetch the board and return the first card matching *predicate*, or ``None``."""
        return find_card(self.get_board(board_id), predicate)

    def get_card(self, board_id: Optional[str], card_id: str) -> BoardCard:
        """Return a card by ID. Raises ``JokelboardError`` (card_not_found) if missing."""
        clean_id = _require_id(card_id, "card_id")
        match = self.find_card(board_id, lambda c, _l: c.get("id") == clean_id)
        if match is None:
            raise JokelboardError("card_not_found", f'Card "{clean_id}" not found on board.', 404, None)
        return match["card"]

    def find_card_by_title(self, board_id: Optional[str], title: str) -> Optional[CardMatch]:
        """Case-insensitive title search. Returns ``None`` if not found."""
        target = _require_id(title, "title").lower()
        return self.find_card(board_id, lambda c, _l: (c.get("title") or "").strip().lower() == target)

    def find_card_by_id(self, board_id: Optional[str], card_id: str) -> Optional[CardMatch]:
        """Search by card ID. Returns ``None`` if not found."""
        target = _require_id(card_id, "card_id")
        return self.find_card(board_id, lambda c, _l: c.get("id") == target)

    # ---- Lists ----

    def create_list(self, board_id: Optional[str], title: str) -> dict[str, Any]:
        """Create a new list."""
        bid = self.resolve_board_id(board_id)
        clean_title = _require_id(title, "title")
        return self._with_revision(bid, lambda _b, rev: self._request(
            "POST", f"/boards/{bid}/lists", {"title": clean_title, "revision": rev}
        ))

    # ---- Cards ----

    def create_card(
        self,
        board_id: Optional[str],
        list_id: str,
        title: str,
        *,
        category_id: Optional[str] = None,
        description: Optional[str] = None,
        description_mode: Optional[str] = None,
        description_size: Optional[str] = None,
        date_type: Optional[str] = None,
        labels: Optional[list[dict[str, Any]]] = None,
        assignees: Optional[list[str]] = None,
        due: Optional[dict[str, str]] = None,
        checklist: Optional[dict[str, Any]] = None,
        attachments: Optional[list[dict[str, Any]]] = None,
    ) -> dict[str, Any]:
        """Create a card in the given list (revision handled automatically)."""
        bid = self.resolve_board_id(board_id)
        clean_list_id = _require_id(list_id, "list_id")
        clean_title = _require_id(title, "title")

        def _op(board: Board, revision: int) -> dict[str, Any]:
            lists = (board.get("data") or {}).get("lists", [])
            if not any(l.get("id") == clean_list_id for l in lists):
                raise JokelboardConfigurationError(f'List "{clean_list_id}" does not exist on this board.')
            body: dict[str, Any] = {"listId": clean_list_id, "title": clean_title, "revision": revision}
            for key, val in [
                ("categoryId", category_id), ("description", description),
                ("descriptionMode", description_mode), ("descriptionSize", description_size),
                ("dateType", date_type), ("labels", labels), ("assignees", assignees),
                ("due", due), ("checklist", checklist), ("attachments", attachments),
            ]:
                if val is not None:
                    body[key] = val
            return self._request("POST", f"/boards/{bid}/cards", body)["card"]

        return self._with_revision(bid, _op)

    def update_card(self, board_id: Optional[str], card_id: str, fields: dict[str, Any]) -> BoardCard:
        """Simple PATCH — caller supplies revision in *fields* if needed. Use ``patch_card`` for auto-revision."""
        bid = self.resolve_board_id(board_id)
        return self._request("PATCH", f"/boards/{bid}/cards/{card_id}", fields)["card"]

    def patch_card(
        self,
        board_id: Optional[str],
        card_id: str,
        patch: Union[dict[str, Any], PatchCardFn],
    ) -> BoardCard:
        """
        Revision-safe PATCH. *patch* may be a plain dict or a callable
        ``(card, list, board) -> dict`` that receives the current card state.
        """
        bid = self.resolve_board_id(board_id)
        clean_id = _require_id(card_id, "card_id")

        def _op(board: Board, revision: int) -> BoardCard:
            if callable(patch):
                match = find_card(board, lambda c, _l: c.get("id") == clean_id)
                if match is None:
                    raise JokelboardError("card_not_found", f'Card "{clean_id}" not found on board.', 404, None)
                resolved = patch(match["card"], match["list"], board)
            else:
                resolved = patch
            if not isinstance(resolved, dict):
                raise JokelboardConfigurationError("Card patch must resolve to a dict.")
            return self._request(
                "PATCH", f"/boards/{bid}/cards/{clean_id}", {**resolved, "revision": revision}
            )["card"]

        return self._with_revision(bid, _op)

    # ---- Custom fields ----

    def get_custom_fields(self, board_id: Optional[str], card_id: str) -> dict[str, str]:
        """Return all custom field values for a card."""
        card = self.get_card(board_id, card_id)
        return card.get("fieldValues") or {}

    def get_custom_field(self, board_id: Optional[str], card_id: str, field_key: str) -> Optional[str]:
        """Return the value of a single custom field, or ``None`` if not set."""
        _require_id(field_key, "field_key")
        return self.get_custom_fields(board_id, card_id).get(field_key)

    def set_custom_field(self, board_id: Optional[str], card_id: str, field_key: str, value: Any) -> BoardCard:
        """Set a single custom field, preserving all other existing field values."""
        _require_id(field_key, "field_key")
        return self.patch_card(board_id, card_id, lambda card, _l, _b: {
            "fieldValues": {**(card.get("fieldValues") or {}), field_key: str(value)}
        })

    def set_custom_fields(self, board_id: Optional[str], card_id: str, fields: dict[str, Any]) -> BoardCard:
        """Merge multiple custom fields, preserving all existing fields not in the update."""
        if not isinstance(fields, dict):
            raise JokelboardConfigurationError("fields must be a dict.")
        normalised = {k: str(v) for k, v in fields.items()}
        return self.patch_card(board_id, card_id, lambda card, _l, _b: {
            "fieldValues": {**(card.get("fieldValues") or {}), **normalised}
        })

    # ---- Move / link / comment ----

    def move_card(
        self,
        board_id: Optional[str],
        card_id: str,
        to_list_id: str,
        *,
        position: Optional[int] = None,
    ) -> None:
        """Move a card to another list (revision handled automatically)."""
        bid = self.resolve_board_id(board_id)
        clean_dest = _require_id(to_list_id, "to_list_id")

        def _op(board: Board, revision: int) -> None:
            lists = (board.get("data") or {}).get("lists", [])
            if not any(l.get("id") == clean_dest for l in lists):
                raise JokelboardConfigurationError(f'Destination list "{clean_dest}" does not exist.')
            body: dict[str, Any] = {"toListId": clean_dest, "revision": revision}
            if position is not None:
                body["position"] = position
            self._request("POST", f"/boards/{bid}/cards/{card_id}/move", body)

        self._with_revision(bid, _op)

    def get_card_link(self, board_id: Optional[str], card_id: str) -> str:
        """Return the shareable web URL for a card."""
        bid = self.resolve_board_id(board_id)
        d = self._request("GET", f"/boards/{bid}/cards/{card_id}/link")
        url = (d or {}).get("url")
        if not isinstance(url, str) or not url:
            raise JokelboardError("invalid_response", "Invalid card link response.", None, d)
        return url

    def add_comment(
        self,
        board_id: Optional[str],
        card_id: str,
        text: str,
        *,
        kind: Optional[str] = None,
    ) -> None:
        """Add a comment to a card (revision handled automatically)."""
        bid = self.resolve_board_id(board_id)
        clean_text = _sanitise_comment(_require_id(text, "text"))
        body: dict[str, Any] = {"text": clean_text}
        if kind is not None:
            body["kind"] = kind
        self._with_revision(bid, lambda _b, rev: self._request(
            "POST", f"/boards/{bid}/cards/{card_id}/comments", {**body, "revision": rev}
        ))

    # ---- Vault ----

    def get_vault(self, board_id: Optional[str] = None) -> list[VaultEntry]:
        """List all vaulted cards grouped by source list."""
        bid = self.resolve_board_id(board_id)
        return self._request("GET", f"/boards/{bid}/vault")["vault"]

    def vault_card(self, board_id: Optional[str], card_id: str) -> None:
        """Archive a card into the vault (revision handled automatically)."""
        bid = self.resolve_board_id(board_id)
        self._with_revision(bid, lambda _b, rev: self._request(
            "POST", f"/boards/{bid}/cards/{card_id}/vault", {"revision": rev}
        ))

    def restore_card(
        self,
        board_id: Optional[str],
        card_id: str,
        *,
        to_list_id: Optional[str] = None,
        position: Optional[int] = None,
    ) -> None:
        """Restore a vaulted card (revision handled automatically)."""
        bid = self.resolve_board_id(board_id)

        def _op(_b: Board, rev: int) -> None:
            body: dict[str, Any] = {"revision": rev}
            if to_list_id is not None:
                body["toListId"] = to_list_id
            if position is not None:
                body["position"] = position
            self._request("POST", f"/boards/{bid}/cards/{card_id}/restore", body)

        self._with_revision(bid, _op)

    def purge_card(self, board_id: Optional[str], card_id: str, revision: Optional[int] = None) -> None:
        """Permanently delete a vaulted card. This action is irreversible."""
        bid = self.resolve_board_id(board_id)
        path = f"/boards/{bid}/vault/{card_id}"
        if revision is not None:
            path += f"?revision={revision}"
        self._request("DELETE", path)

    # ---- Board tokens ----

    def list_board_tokens(self, board_id: Optional[str]) -> list[Token]:
        bid = self.resolve_board_id(board_id)
        return self._request("GET", f"/boards/{bid}/tokens")["tokens"]

    def create_board_token(self, board_id: Optional[str], name: str, type: str) -> Token:
        bid = self.resolve_board_id(board_id)
        return self._request("POST", f"/boards/{bid}/tokens", {"name": name, "type": type})["token"]

    def delete_board_token(self, board_id: Optional[str], token_id: str) -> None:
        bid = self.resolve_board_id(board_id)
        self._request("DELETE", f"/boards/{bid}/tokens/{token_id}")

    # ---- Profile tokens ----

    def list_profile_tokens(self) -> list[Token]:
        return self._request("GET", "/me/tokens")["tokens"]

    def create_profile_token(self, name: str) -> Token:
        return self._request("POST", "/me/tokens", {"name": name, "type": "programmatic"})["token"]

    def delete_profile_token(self, token_id: str) -> None:
        self._request("DELETE", f"/me/tokens/{token_id}")

    # ---- Org tokens ----

    def list_org_tokens(self, org_id: str) -> list[Token]:
        return self._request("GET", f"/organisations/{org_id}/tokens")["tokens"]

    def create_org_token(self, org_id: str, name: str) -> Token:
        return self._request("POST", f"/organisations/{org_id}/tokens", {"name": name})["token"]

    def delete_org_token(self, org_id: str, token_id: str) -> None:
        self._request("DELETE", f"/organisations/{org_id}/tokens/{token_id}")

    def configure_org_bot_token(
        self, org_id: str, token_id: str, *, name: Optional[str] = None, avatar: Optional[str] = None
    ) -> Token:
        """Configure bot identity for an org token."""
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if avatar is not None:
            body["avatar"] = avatar
        return self._request("PATCH", f"/organisations/{org_id}/tokens/{token_id}/bot", body)["token"]


# ---- Plugin client ----

class _PluginClient:
    """Access the Jokelboard Plugin API (checklist surface)."""

    def __init__(self, request: Any) -> None:
        self._request = request

    def get_board(self, board_id: str) -> PluginBoard:
        return self._request("GET", f"/plugin/boards/{board_id}")["board"]

    def toggle_checklist_item(self, board_id: str, card_id: str, item_id: str) -> dict[str, Any]:
        return self._request(
            "POST", f"/plugin/boards/{board_id}/cards/{card_id}/checklist-items/{item_id}/toggle"
        )["item"]

    def get_access_level(self) -> Any:
        return self._request("GET", "/plugin/access-level")
