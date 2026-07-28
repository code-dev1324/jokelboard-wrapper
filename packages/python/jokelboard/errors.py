from __future__ import annotations

from typing import Any, Optional


class JokelboardConfigurationError(ValueError):
    """Raised for invalid constructor arguments or missing required values."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.code = "configuration_error"
        self.retryable = False

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.__class__.__name__, "message": str(self), "code": self.code, "retryable": False}

    def __repr__(self) -> str:
        return f"JokelboardConfigurationError({str(self)!r})"


class JokelboardError(Exception):
    """Base exception for all Jokelboard API errors."""

    def __init__(
        self,
        code: str,
        message: str,
        status: Optional[int],
        raw: object = None,
        *,
        method: Optional[str] = None,
        path: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.raw = raw
        self.method = method
        self.path = path
        self.retryable = (
            status is None
            or status == 429
            or status >= 500
            or code == "revision_conflict"
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.__class__.__name__,
            "message": str(self),
            "code": self.code,
            "status": self.status,
            "method": self.method,
            "path": self.path,
            "retryable": self.retryable,
        }

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(code={self.code!r}, status={self.status})"


class RateLimitError(JokelboardError):
    """Raised when the API returns 429 and retries are exhausted."""

    def __init__(
        self,
        message: str,
        retry_after: int,
        raw: object = None,
        *,
        method: Optional[str] = None,
        path: Optional[str] = None,
    ) -> None:
        super().__init__("rate_limited", message, 429, raw, method=method, path=path)
        self.retry_after = retry_after


class RevisionConflictError(JokelboardError):
    """Raised on a 409 revision_conflict — re-fetch the board and retry."""

    def __init__(
        self,
        message: str,
        current_revision: Optional[int],
        raw: object = None,
        *,
        method: Optional[str] = None,
        path: Optional[str] = None,
    ) -> None:
        super().__init__("revision_conflict", message, 409, raw, method=method, path=path)
        self.current_revision = current_revision
