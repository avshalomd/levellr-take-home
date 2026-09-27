"""Label every conversation with Jev: one yes/no per topic, sentiment, and the six flags, in ONE request each.

Ported from the reference. Why Jev and not an LLM: every one of these is a closed judgment. Jev answers all of them
over the same state in one call, returns probabilities instead of text, and costs $0.042 per million input tokens.
The probabilities are stored, not verdicts, so the app chooses its own thresholds and an unsure label shows as unsure.

Changed from the reference: Jev is reached through OpenRouter's decisions endpoint over plain HTTP (the same request
and answer shape as src/lib/llm/decide.ts), because the TypeSafe account is out of credit. The flags are this
dataset's six (flags.py). Topics come from data/work/topics.json, the label set a person approved; without it the
run stops, because labelling against unapproved topics would be paid work thrown away.

Each topic is its own Noul, so a conversation can carry several topics. The transcript is sent whole up to
STATE_CHARS, which is above the longest transcript in this dataset, so nothing is cut.

Resumable: answers are appended to data/work/labels.jsonl keyed by conversation id + a hash of the transcript + a hash
of the questions, so a re-run labels only what is new or failed, and a changed label set re-asks everything. Every
call is checked against budget.py before it is made and charged with OpenRouter's own cost figure.

usage (from ingest/): uv run --env-file ../.env.local python enrich.py [--limit N] [--concurrency 16]
                      [--topics PATH] [--out PATH]
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import sys
import time
from pathlib import Path

import httpx

import budget
from build import WORK
from flags import FLAGS

URL = "https://openrouter.ai/api/alpha/decisions"
MODEL = "typesafe/jev-1.13"  # pinned: "latest" could move under the thresholds the app is tuned to
STATE_CHARS = 8000  # the longest transcript here is ~6,700 chars; Jev reads 32K tokens

# The one per-topic question (the reference's topic-question.json). load.py writes it into dataset_meta so the app's
# relabel, if built, asks the same question and a topic means the same thing to both.
TOPIC_QUESTION = ("Is `conversation`, from `community`, about this topic: {name} ({description})? Answer yes when a "
                  "real part of the conversation discusses it, even if it is not the main subject; answer no when it "
                  "is only mentioned in passing.")

SENTIMENT_LEVELS = [
    "Very negative: angry, hostile or despairing about the games, an update, or the people behind them",
    "Negative: complaining, disappointed or frustrated",
    "Neutral or mixed: factual, asking, or positive and negative in balance",
    "Positive: satisfied, enjoying, appreciative",
    "Very positive: enthusiastic, celebrating, praising",
]
DEFAULT_MOOD_TARGET = "the games, their updates and announcements, and the company behind them"


def community() -> str:
    """Who is talking, from the dataset's manifest: the only domain knowledge enrichment gets."""
    src = json.load(open(WORK / "source.json"))
    return f"{src['community']}: {src['about']}"


def load_topics(path: Path) -> dict:
    """The approved label set: {labels: [{key, name, description}], mood_target?}. Fails loudly when missing."""
    if not path.exists():
        raise SystemExit(f"no approved topics at {path}: approve a label set (data/work/suggested.json) and save it "
                         "there as topics.json first, or pass --topics")
    data = json.load(open(path))
    labels = [l for l in data.get("labels", []) if l["key"] != "other"]  # "other" = no topic clears 0.5
    if not labels:
        raise SystemExit(f"{path} has no labels")
    return {**data, "labels": labels}


def topic_qid(key: str) -> str:
    return "topic_" + key.replace("-", "_")


def mood_target(accepted: dict) -> str:
    mt = accepted.get("mood_target")
    return (mt.get("target") if isinstance(mt, dict) else mt) or DEFAULT_MOOD_TARGET


def questions(topics: list[dict]) -> dict:
    q: dict = {"sentiment": {"type": "score", "criteria": SENTIMENT_LEVELS,
                             "instructions": "What is the overall sentiment of the people in `conversation` towards "
                                             "`mood_target`?"}}
    for name, text in FLAGS.items():
        q[name] = {"type": "noul", "instructions": f"About `conversation`: {text}"}
    for t in topics:
        q[topic_qid(t["key"])] = {"type": "noul",
                                  "instructions": TOPIC_QUESTION.format(name=t["name"], description=t["description"])}
    return q


def qhash(qs: dict) -> str:
    return hashlib.sha256(json.dumps(qs, sort_keys=True).encode()).hexdigest()[:12]


def digest(transcript: str) -> str:
    return hashlib.sha256(transcript.encode()).hexdigest()[:16]


def to_row(conv_id: str, h: str, qh: str, topics: list[dict], resp: dict) -> dict:
    a = resp["answers"]
    sent = a["sentiment"]
    return {
        "id": conv_id,
        "hash": h,
        "qhash": qh,
        "model": resp.get("model") or MODEL,
        "sentiment": sent["score"] / (len(SENTIMENT_LEVELS) - 1),  # 0 very negative .. 1 very positive
        "sentiment_conf": sent.get("confidence"),
        **{f"p_{name}": a[name]["noul"] for name in FLAGS},
        "topic_p": {t["key"]: a[topic_qid(t["key"])]["noul"] for t in topics},
        "raw": {"sentiment": sent.get("probabilities")},
        "input_tokens": (resp.get("usage") or {}).get("input_tokens"),
        "cost": (resp.get("usage") or {}).get("cost"),
    }


async def ask(client: httpx.AsyncClient, state: dict, qs: dict) -> dict:
    """One decision, retried on a rate limit or a provider hiccup; a 4xx that is not 429 is not retried."""
    last = ""
    for attempt in range(5):
        try:
            r = await client.post(URL, json={"model": MODEL, "state": state, "questions": qs})
            data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            if r.status_code == 200 and data.get("answers"):
                missing = [k for k in qs if k not in data["answers"]]
                if not missing:
                    return data
                last = f"unanswered: {missing}"
            else:
                last = f"HTTP {r.status_code}: {r.text[:200]}"
                if 400 <= r.status_code < 500 and r.status_code != 429:
                    break
        except httpx.HTTPError as e:
            last = f"{type(e).__name__}: {e}"
        await asyncio.sleep(2 * 2**attempt)
    raise RuntimeError(last)


async def run(limit: int | None, concurrency: int, topics_path: Path, out_path: Path) -> None:
    accepted = load_topics(topics_path)
    topics = accepted["labels"]
    qs = questions(topics)
    qh = qhash(qs)
    comm, target = community(), mood_target(accepted)
    convs = [json.loads(line) for line in open(WORK / "conversations.jsonl")]
    done = set()
    if out_path.exists():
        done = {(r["id"], r["hash"]) for r in map(json.loads, open(out_path)) if r.get("qhash") == qh}
    todo = [c for c in convs if (c["id"], digest(c["transcript"])) not in done]
    if limit:
        todo = todo[:limit]
    q_tokens = len(json.dumps(qs)) // 4
    est = sum((min(len(c["transcript"]), STATE_CHARS) + len(comm) + len(target)) // 4 + q_tokens for c in todo)
    print(f"{len(topics)} topics + sentiment + {len(FLAGS)} flags = {len(qs)} questions per request")
    print(f"{len(convs)} conversations, {len(done)} labelled, {len(todo)} to do, ~{est:,} tokens "
          f"(~${est * budget.PRICE_PER_MTOK['jev'] / 1e6:.3f}); spent so far ${budget.spent():.4f}")
    budget.check("jev", est)

    sem = asyncio.Semaphore(concurrency)
    lock = asyncio.Lock()
    failures, n, latencies = 0, 0, []
    started = time.time()
    headers = {"Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}", "X-Title": "levellr-take-home"}
    with open(out_path, "a") as out:
        async with httpx.AsyncClient(headers=headers, timeout=60) as client:

            async def one(c: dict) -> None:
                nonlocal failures, n
                state = {"community": comm, "mood_target": target, "conversation": c["transcript"][:STATE_CHARS]}
                async with sem:
                    t0 = time.time()
                    try:
                        resp = await ask(client, state, qs)
                    except RuntimeError as e:
                        failures += 1
                        print(f"  FAIL {c['id']}: {str(e)[:200]}", file=sys.stderr)
                        return
                    latencies.append(time.time() - t0)
                row = to_row(c["id"], digest(c["transcript"]), qh, topics, resp)
                async with lock:
                    budget.charge("jev", row["input_tokens"] or 0, row["cost"])
                    out.write(json.dumps(row) + "\n")
                    n += 1
                    if n % 200 == 0:
                        out.flush()
                        print(f"  {n}/{len(todo)} labelled, ${budget.spent():.4f} spent", file=sys.stderr)

            await asyncio.gather(*(one(c) for c in todo))
    wall = time.time() - started
    lat = sorted(latencies) or [0.0]
    print(f"labelled {n}, failed {failures} in {wall:.1f}s at concurrency {concurrency}; latency p50 "
          f"{lat[len(lat) // 2]:.2f}s, max {lat[-1]:.2f}s; total spend ${budget.spent():.4f} of ${budget.CAP_USD:.2f}")
    if failures:
        sys.exit(3)  # re-run to retry just the failures


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--concurrency", type=int, default=16)
    ap.add_argument("--topics", type=Path, default=WORK / "topics.json")
    ap.add_argument("--out", type=Path, default=WORK / "labels.jsonl")
    a = ap.parse_args()
    asyncio.run(run(a.limit, a.concurrency, a.topics, a.out))
