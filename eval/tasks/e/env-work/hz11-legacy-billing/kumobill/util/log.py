"""Debug logging to stderr, enabled with KUMOBILL_DEBUG=1."""
import os
import sys


def debug(*parts) -> None:
    if os.environ.get("KUMOBILL_DEBUG") == "1":
        print("[kumobill]", *parts, file=sys.stderr)
