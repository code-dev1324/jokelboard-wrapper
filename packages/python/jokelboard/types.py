"""TypedDict definitions matching the Jokelboard API data model."""

from __future__ import annotations

from typing import Any, Literal, Optional, TypedDict


class Label(TypedDict, total=False):
    id: str
    name: str
    color: str
    twoTone: bool
    borderColor: str


class ChecklistItem(TypedDict, total=False):
    id: str
    text: str
    done: bool


class Checklist(TypedDict):
    items: list[ChecklistItem]


class Attachment(TypedDict, total=False):
    id: str
    name: str
    url: str


class DueDate(TypedDict, total=False):
    iso: str
    overdue: bool


class Comment(TypedDict, total=False):
    id: str
    author: str
    authorSub: str
    botTokenId: str
    botOrgId: str
    text: str
    ts: int
    kind: Literal["comment", "docucomment"]


class BoardCard(TypedDict, total=False):
    id: str
    kind: str
    ticket: str
    createdAt: int
    title: str
    categoryId: str
    severity: str
    description: str
    descriptionMode: Literal["plain", "markdown", "fields"]
    descriptionSize: Literal["small", "normal", "large"]
    fieldValues: dict[str, str]
    labels: list[Label]
    assignees: list[str]
    comments: list[Comment]
    checklist: Checklist
    attachments: list[Attachment]
    due: Optional[DueDate]
    dateType: Literal["due", "static", "employee"]
    dueJoin: Optional[dict[str, str]]
    dueDepart: Optional[dict[str, str]]
    vaultedAt: int
    vaultedBy: Optional[str]


class BoardList(TypedDict, total=False):
    id: str
    title: str
    cards: list[BoardCard]
    vaultedCards: list[BoardCard]


class BoardData(TypedDict, total=False):
    title: str
    lists: list[BoardList]
    presets: dict[str, Any]


class BoardSummary(TypedDict):
    id: str
    workspace: str
    name: str
    title: str
    created_at: int
    updated_at: int
    revision: int
    url: str


class Board(BoardSummary, total=False):
    data: BoardData


class Token(TypedDict, total=False):
    id: str
    kind: Literal["board", "profile", "org"]
    name: str
    tokenPrefix: str
    scopes: list[str]
    boardId: Optional[str]
    orgId: Optional[str]
    createdBySub: Optional[str]
    created_at: int
    last_used_at: Optional[int]
    bot: Optional[dict[str, Any]]


class VaultedCard(TypedDict, total=False):
    id: str
    title: str
    vaultedAt: int
    vaultedBy: Optional[str]


class VaultEntry(TypedDict):
    listId: str
    listTitle: str
    cards: list[VaultedCard]


class PluginCard(TypedDict, total=False):
    id: str
    title: str
    checklist: Checklist


class PluginList(TypedDict):
    id: str
    title: str
    cards: list[PluginCard]


class PluginBoard(TypedDict):
    id: str
    name: str
    lists: list[PluginList]


class CardLink(TypedDict):
    cardId: str
    listId: str
    boardId: str
    canonical: bool
    path: str
    url: str
