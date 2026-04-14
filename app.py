import os
import socket
import uvicorn


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
    keep full FastAPI + web frontend so training/prediction and Agent tool-calling
    remain exactly the same as local development.
    """
    host = _resolve_host()
    port = int(os.environ.get("PORT", "7860"))
    uvicorn.run("server.main:app", host=host, port=port, log_level=os.environ.get("LOG_LEVEL", "info"))


if __name__ == "__main__":
    main()
