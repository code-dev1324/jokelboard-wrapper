from __future__ import annotations


class JokelboardError(Exception):
    """Base exception for all Jokelboard API errors."""

    def __init__(self, code: str, message: str, status: int, raw: object = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.raw = raw

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(code={self.code!r}, status={self.status})"


class RateLimitError(JokelboardError):
    """Raised when the API returns 429 and retries are exhausted."""

    def __init__(self, message: str, retry_after: int, limit: int, window_ms: int, raw: object = None) -> None:
        super().__init__("card_rate_limited", message, 429, raw)
        self.retry_after = retry_after
        self.limit = limit
        self.window_ms = window_ms


class RevisionConflictError(JokelboardError):
    """Raised on a 409 revision_conflict — re-fetch the board and retry."""

    def __init__(self, message: str, current_revision: int, raw: object = None) -> None:
        super().__init__("revision_conflict", message, 409, raw)
        self.current_revision = current_revision
