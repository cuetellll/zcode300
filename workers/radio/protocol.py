"""Radio worker protocol: JSON lines over stdin/stdout.

Manager -> worker: {"type": "init"|"switch"|"stop", ...}
Worker  -> manager: {"type": "ready"|"switching"|"live"|"status"|"error"|"exited", ...}

All diagnostics go to stderr (picked up as worker logs by the manager).
"""

import json
import sys


def send_message(payload: dict) -> None:
    """Write a protocol message to stdout (single line) and flush."""
    try:
        sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    except (BrokenPipeError, ValueError):
        # Manager is gone; the main loop will exit via stdin EOF.
        pass


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def read_line() -> "str | None":
    """Blocking stdin read (run inside a thread). None on EOF."""
    line = sys.stdin.readline()
    if not line:
        return None
    return line.strip()


def parse_message(line: str) -> "dict | None":
    try:
        value = json.loads(line)
        return value if isinstance(value, dict) else None
    except json.JSONDecodeError:
        return None
