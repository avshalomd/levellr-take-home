"""Source records -> one canonical message shape.

Everything downstream (grouping, labelling, the database, the app) sees only `Message`. A new source needs one more
adapter here and a manifest in datasets/<name>.json (what the community is, where its raw file is, which authors are
bots, how authors are named); nothing else changes (DECISIONS D18).

One adapter exists, for the brief's export ("discord-json"): a JSON array of
{id, community_id, channel, author{id, name}, timestamp, text, reactions[{emoji, count}], reply_to}.
- channel = channel; reply_to = the parent message id (every reply stays inside its channel);
- n_reactions = the sum of reaction counts (what the app reads as `score`); the per-emoji list is kept as it came;
- authors are already pseudonyms in the export ("authors": "pseudonymous" in the manifest), so the name is kept as
  given and the stable account id is kept beside it for counting distinct people.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class Message:
    id: str  # the export's id, e.g. msg_000001
    ref: int  # the short number the app cites as msgN: the export's own number (see load_discord_json)
    channel: str
    reply_to: str | None  # parent message id; None when not a reply
    author: str  # the export's display name (already a pseudonym)
    author_id: str  # the stable account id: distinct people are counted on this
    ts: str  # ISO 8601 UTC
    text: str
    n_reactions: int  # the sum of reaction counts
    reactions: list[dict] = field(default_factory=list)  # [{emoji, count}] as exported
    is_bot: bool = False


def utc(ts: str) -> str:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()


def from_discord_json(m: dict, bots: set[str] = frozenset()) -> Message:
    author = m.get("author") or {}
    reactions = [{"emoji": r.get("emoji"), "count": int(r.get("count") or 0)} for r in m.get("reactions") or []]
    return Message(
        id=str(m["id"]),
        ref=0,  # set by load_discord_json once every message is in time order
        channel=m.get("channel") or "unknown",
        reply_to=m.get("reply_to") or None,
        author=author.get("name") or "unknown",
        author_id=str(author.get("id") or author.get("name") or "unknown"),
        ts=utc(m["timestamp"]),
        text=(m.get("text") or "").strip(),
        n_reactions=sum(r["count"] for r in reactions),
        reactions=reactions,
        is_bot=author.get("name") in bots or author.get("id") in bots,
    )


def load_discord_json(path: Path, bots: set[str] = frozenset()) -> list[Message]:
    msgs = [from_discord_json(m, bots) for m in json.load(open(path))]
    msgs.sort(key=lambda m: (m.ts, m.id))
    # msgN reuses the export's own number (msg_005781 -> msg5781) so a citation can be found in the source file;
    # when ids are not of that form, the position in time order stands in.
    nums = [m.id.rsplit("_", 1)[-1] for m in msgs]
    own = all(n.isdigit() for n in nums) and len({int(n) for n in nums}) == len(nums)
    for i, (m, n) in enumerate(zip(msgs, nums), 1):
        m.ref = int(n) if own else i
    return msgs


def write_jsonl(msgs: list[Message], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        for m in msgs:
            f.write(json.dumps(asdict(m), ensure_ascii=False) + "\n")
