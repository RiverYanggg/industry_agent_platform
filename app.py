import os
import socket
import uvicorn

from server.main import app as app


def _resolve_host() -> str:
    candidate = (os.environ.get("HOST") or "").strip()
    if not candidate:
        return "0.0.0.0"
    if "://" in candidate or "/" in candidate:
        return "0.0.0.0"
    try:
        socket.getaddrinfo(candidate, None)
        return candidate
    except OSError:
        return "0.0.0.0"


def main() -> None:
    """
    Platform entrypoint:
    expose ASGI `app` for hosted platforms and keep direct local execution working.
    """
    host = _resolve_host()
    port = int(os.environ.get("PORT", "7860"))
    uvicorn.run("app:app", host=host, port=port, log_level=os.environ.get("LOG_LEVEL", "info"))


if __name__ == "__main__":
    main()
