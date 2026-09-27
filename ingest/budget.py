"""Every paid call in the pipeline goes through here, so the total spend is known and capped.

Ported from the reference. The ledger is a JSON file (data/work/spend.json) so it survives restarts: a re-run of a
step adds to it. `check()` refuses a call whose estimate would take the total over the cap, before the call is made.
"""

from __future__ import annotations

import json

from build import WORK

LEDGER = WORK / "spend.json"
CAP_USD = 3.00

# USD per million input tokens, for the pre-call estimate. A finished call is charged with the caller's own figure.
PRICE_PER_MTOK = {
    "llm": 0.10,  # the suggestion call on Gemini Flash-Lite, input (suggest.py prices output itself)
}


class BudgetExceeded(RuntimeError):
    pass


def _load() -> dict:
    if LEDGER.exists():
        return json.loads(LEDGER.read_text())
    return {"cap_usd": CAP_USD, "by_kind": {}, "total_usd": 0.0}


def spent() -> float:
    return _load()["total_usd"]


def check(kind: str, est_tokens: int) -> None:
    """Raise before a call whose estimated cost would cross the cap."""
    est = est_tokens * PRICE_PER_MTOK[kind] / 1e6
    total = spent()
    if total + est > CAP_USD:
        raise BudgetExceeded(f"{kind}: ${total:.4f} spent + ${est:.4f} estimated > ${CAP_USD:.2f} cap")


def charge(kind: str, tokens: int, usd: float | None = None) -> float:
    """Record a finished call. `usd` is the caller's figure when it has one."""
    cost = usd if usd is not None else tokens * PRICE_PER_MTOK[kind] / 1e6
    led = _load()
    k = led["by_kind"].setdefault(kind, {"tokens": 0, "usd": 0.0, "calls": 0})
    k["tokens"] += tokens
    k["usd"] += cost
    k["calls"] += 1
    led["total_usd"] = sum(v["usd"] for v in led["by_kind"].values())
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    LEDGER.write_text(json.dumps(led, indent=2))
    return led["total_usd"]
