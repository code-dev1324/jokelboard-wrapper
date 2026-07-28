"""Jokelboard API client."""

from __future__ import annotations

import time
from typing import Any, Optional

import httpx

from .errors import JokelboardError, RateLimitError, RevisionConflictError
from .types import Board, BoardCard, BoardData, BoardList, BoardSummary, CardLink, PluginBoard, Token, VaultEntry

DEFAULT_BASE_URL = "https://api.jokelboard.com/api/v1"
DEFAULT_TIMEOUT = 10.0
DEFAULT_MAX_RETRIES = 3


class JokelboardClient:
    """
    Synchronous Jokelboard API client.

    Usage::

        with JokelboardClient(token="jkb_...") as client:
            boards = client.list_boards()
    """

    def __init__(
        self,
        token: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        retry_on_rate_limit: bool = True,
        max_retries: int = DEFAULT_MAX_RETRIES,
    ) -> None:
        """
        Args:
            token: Jokelboard API token (``jkb_...``).
            base_url: Override the API base URL.
            timeout: Request timeout in seconds.
            retry_on_rate_limit: Automatically retry on 429 with the server's ``retryAfter`` delay.
            max_retries: Maximum number of retry attempts.
        """
        self._http = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {token}"},
            timeout=timeout,
        )
        self._retry_on_rate_limit = retry_on_rate_limit
        self._max_retries = max_retries
        self.plugin = _PluginClient(self._request)

    def close(self) -> None:
        """Close the underlying HTTP session."""
        self._http.close()

    def __enter__(self) -> "JokelboardClient":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    def _request(self, method: str, path: str, body: Optional[dict[str, Any]] = None, attempt: int = 0) -> Any:
        res = self._http.request(method, path, json=body)

        try:
            data = res.json()
        except Exception:
            data = None

        if res.is_success:
            return data

        if res.status_code == 429 and self._retry_on_rate_limit and attempt < self._max_retries:
            retry_after = (data or {}).get("retryAfter", 1)
            time.sleep(retry_after)
            return self._request(method, path, body, attempt + 1)

        if res.status_code == 429:
            d = data or {}
            raise RateLimitError(d.get("message", "Rate limit exceeded"), d.get("retryAfter", 1), d.get("limit", 10), d.get("windowMs", 5000), data)

        if res.status_code == 409 and (data or {}).get("error") == "revision_conflict":
            d = data or {}
            raise RevisionConflictError(d.get("message", "Revision conflict"), d.get("currentRevision", 0), data)

        d = data or {}
        raise JokelboardError(d.get("error", "unknown_error"), d.get("message", f"HTTP {res.status_code}"), res.status_code, data)

    # ---- Me ----

    def get_me(self) -> dict[str, Any]:
        """Return token owner and metadata."""
        return self._request("GET", "/me")

    # ---- Boards ----

    def list_boards(self) -> list[BoardSummary]:
        """List all boards reachable by the token."""
        return self._request("GET", "/boards")["boards"]

    def get_board(self, board_id: str) -> Board:
        """Fetch a board with its full data payload."""
        return self._request("GET", f"/boards/{board_id}")["board"]

    def replace_board(self, board_id: str, data: BoardData, revision: Optional[int] = None) -> Board:
        """Replace the entire board data object."""
        body: dict[str, Any] = {"data": data}
        if revision is not None:
            body["revision"] = revision
        return self._request("PUT", f"/boards/{board_id}", body)["board"]

    # ---- Lists ----

    def create_list(self, board_id: str, title: str, *, id: Optional[str] = None, revision: Optional[int] = None) -> BoardList:
        """Create a new list at the end of the board."""
        body: dict[str, Any] = {"title": title}
        if id is not None:
            body["id"] = id
        if revision is not None:
            body["revision"] = revision
        return self._request("POST", f"/boards/{board_id}/lists", body)["list"]

    # ---- Cards ----

    def create_card(
        self,
        board_id: str,
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
        revision: Optional[int] = None,
    ) -> dict[str, Any]:
        """Create a card in the given list."""
        body: dict[str, Any] = {"listId": list_id, "title": title}
        if category_id is not None:
            body["categoryId"] = category_id
        if description is not None:
            body["description"] = description
        if description_mode is not None:
            body["descriptionMode"] = description_mode
        if description_size is not None:
            body["descriptionSize"] = description_size
        if date_type is not None:
            body["dateType"] = date_type
        if labels is not None:
            body["labels"] = labels
        if assignees is not None:
            body["assignees"] = assignees
        if due is not None:
            body["due"] = due
        if checklist is not None:
            body["checklist"] = checklist
        if attachments is not None:
            body["attachments"] = attachments
        if revision is not None:
            body["revision"] = revision
        return self._request("POST", f"/boards/{board_id}/cards", body)["card"]

    def update_card(self, board_id: str, card_id: str, fields: dict[str, Any]) -> BoardCard:
        """Partially update a card. Pass only the fields you want to change."""
        return self._request("PATCH", f"/boards/{board_id}/cards/{card_id}", fields)["card"]

    def move_card(self, board_id: str, card_id: str, to_list_id: str, *, position: Optional[int] = None, revision: Optional[int] = None) -> None:
        """Move a card to another list or reorder it within the current list."""
        body: dict[str, Any] = {"toListId": to_list_id}
        if position is not None:
            body["position"] = position
        if revision is not None:
            body["revision"] = revision
        self._request("POST", f"/boards/{board_id}/cards/{card_id}/move", body)

    def get_card_link(self, board_id: str, card_id: str) -> CardLink:
        """Return the shareable web URL for a card."""
        return self._request("GET", f"/boards/{board_id}/cards/{card_id}/link")

    def add_comment(self, board_id: str, card_id: str, text: str, *, kind: Optional[str] = None, revision: Optional[int] = None) -> None:
        """Add a comment to a card."""
        body: dict[str, Any] = {"text": text}
        if kind is not None:
            body["kind"] = kind
        if revision is not None:
            body["revision"] = revision
        self._request("POST", f"/boards/{board_id}/cards/{card_id}/comments", body)

    # ---- Vault ----

    def get_vault(self, board_id: str) -> list[VaultEntry]:
        """List all soft-deleted cards grouped by source list."""
        return self._request("GET", f"/boards/{board_id}/vault")["vault"]

    def vault_card(self, board_id: str, card_id: str, revision: Optional[int] = None) -> None:
        """Soft-delete a card into the vault."""
        body = {"revision": revision} if revision is not None else None
        self._request("POST", f"/boards/{board_id}/cards/{card_id}/vault", body)

    def restore_card(self, board_id: str, card_id: str, *, to_list_id: Optional[str] = None, position: Optional[int] = None, revision: Optional[int] = None) -> None:
        """Restore a vaulted card to a live list."""
        body: dict[str, Any] = {}
        if to_list_id is not None:
            body["toListId"] = to_list_id
        if position is not None:
            body["position"] = position
        if revision is not None:
            body["revision"] = revision
        self._request("POST", f"/boards/{board_id}/cards/{card_id}/restore", body or None)

    def purge_card(self, board_id: str, card_id: str, revision: Optional[int] = None) -> None:
        """Permanently delete a vaulted card. This action is irreversible."""
        path = f"/boards/{board_id}/vault/{card_id}"
        if revision is not None:
            path += f"?revision={revision}"
        self._request("DELETE", path)

    # ---- Board tokens ----

    def list_board_tokens(self, board_id: str) -> list[Token]:
        return self._request("GET", f"/boards/{board_id}/tokens")["tokens"]

    def create_board_token(self, board_id: str, name: str, type: str) -> Token:
        return self._request("POST", f"/boards/{board_id}/tokens", {"name": name, "type": type})["token"]

    def delete_board_token(self, board_id: str, token_id: str) -> None:
        self._request("DELETE", f"/boards/{board_id}/tokens/{token_id}")

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

    def configure_org_bot_token(self, org_id: str, token_id: str, *, name: Optional[str] = None, avatar: Optional[str] = None) -> Token:
        """Configure bot identity for an org token."""
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if avatar is not None:
            body["avatar"] = avatar
        return self._request("PATCH", f"/organisations/{org_id}/tokens/{token_id}/bot", body)["token"]


class _PluginClient:
    """Access the Jokelboard Plugin API (checklist surface)."""

    def __init__(self, request: Any) -> None:
        self._request = request

    def get_board(self, board_id: str) -> PluginBoard:
        """Fetch board/list/card/checklist structure via the Plugin API."""
        return self._request("GET", f"/plugin/boards/{board_id}")["board"]

    def toggle_checklist_item(self, board_id: str, card_id: str, item_id: str) -> dict[str, Any]:
        """Toggle a checklist item's done state."""
        return self._request("POST", f"/plugin/boards/{board_id}/cards/{card_id}/checklist-items/{item_id}/toggle")["item"]

    def get_access_level(self) -> Any:
        """Probe the plugin access level for the current token."""
        return self._request("GET", "/plugin/access-level")
