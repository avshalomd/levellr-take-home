"""Raw export -> data/work/messages.jsonl + conversations.jsonl + conversation_of.json + source.json.
Free, deterministic, no network.

A dataset is described by its manifest, datasets/<name>.json: the platform (which adapter), the community's name and
a line on what it is about (the only domain knowledge any later step gets), the raw file, and bot accounts.
source.json carries the manifest forward to the later steps.

usage (from ingest/): uv run python build.py ../datasets/levellr.json
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from dataclasses import asdict
from pathlib import Path

from group import group_by_time_gap
from normalize import load_discord_json, write_jsonl

ROOT = Path(__file__).resolve().parent.parent
# The main checkout's data/ (gitignored). A worktree has no data/, so it resolves to the checkout that holds it.
DATA = next((p / "data" for p in [ROOT, *ROOT.parents] if (p / "data" / "messages.json").exists()), ROOT / "data")
WORK = DATA / "work"

# platform -> (adapter, grouping). The export has reply links, but 63% of messages are not replies, so the unit is
# the time-gap session per channel, with reply parents from outside carried as context (DECISIONS.md).
ADAPTERS = {
    "discord-json": (load_discord_json, group_by_time_gap),
}


def pct(xs: list[int], q: float) -> int:
    return xs[min(len(xs) - 1, int(len(xs) * q))]


def main(manifest_path: Path) -> None:
    manifest = json.load(open(manifest_path))
    load, group = ADAPTERS[manifest["platform"]]
    msgs = load(DATA.parent / manifest["raw"], set(manifest.get("bots") or []))
    convs = group(msgs)
    conv_of = {mid: c.id for c in convs for mid in c.member_ids}
    missing = [m.id for m in msgs if m.id not in conv_of]
    assert not missing, f"{len(missing)} messages in no conversation, e.g. {missing[:3]}"
    assert len(conv_of) == sum(len(c.member_ids) for c in convs), "a message is a member of two conversations"

    WORK.mkdir(parents=True, exist_ok=True)
    write_jsonl(msgs, WORK / "messages.jsonl")
    (WORK / "conversation_of.json").write_text(json.dumps(conv_of))
    (WORK / "source.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    with open(WORK / "conversations.jsonl", "w") as f:
        for c in convs:
            f.write(json.dumps(asdict(c), ensure_ascii=False) + "\n")

    sizes = sorted(c.n_messages for c in convs)
    chars = sorted(len(c.transcript) for c in convs)
    eng = sorted(c.engagement for c in convs)
    ctx = sum(len(c.context_ids) for c in convs)
    session = lambda cid: cid.rsplit(":w", 1)[0]
    ctx_window = sum(session(conv_of[p]) == session(c.id) for c in convs for p in c.context_ids)
    replies = [m for m in msgs if m.reply_to]
    orphan = sum(1 for m in replies if m.reply_to not in conv_of)
    print(f"{len(msgs)} messages, {len(convs)} conversations ({Counter(c.kind for c in convs)}) in "
          f"{len({c.channel for c in convs})} channels")
    print(f"messages per conversation: p50 {pct(sizes, .5)}, p90 {pct(sizes, .9)}, max {sizes[-1]}; "
          f"single-message {sum(s == 1 for s in sizes)}; full windows ({sizes[-1]}) {sum(s == sizes[-1] for s in sizes)}")
    print(f"engagement: p50 {pct(eng, .5)}, p90 {pct(eng, .9)}, max {eng[-1]}")
    print(f"replies {len(replies)}: {sum(c.n_replies for c in convs)} with the parent in the same conversation, "
          f"{ctx} parents attached as context ({ctx_window} from an earlier window of the same session, "
          f"{ctx - ctx_window} from an earlier session), {orphan} whose parent is not in the export")
    print(f"transcript chars: median {pct(chars, .5)}, p95 {pct(chars, .95)}, max {chars[-1]}, "
          f"total {sum(chars):,} (~{sum(chars) // 4:,} tokens)")
    print(f"window: {msgs[0].ts} .. {msgs[-1].ts}")
    print(f"wrote {WORK}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
