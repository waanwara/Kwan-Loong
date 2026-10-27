from __future__ import annotations

import json
import sys

from .fire_propagation import simulate_fire


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        result = simulate_fire(payload)
        json.dump(result, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        return 0
    except Exception as exc:
        json.dump(
            {
                "status": "error",
                "message": str(exc),
            },
            sys.stdout,
            ensure_ascii=False,
        )
        sys.stdout.write("\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
