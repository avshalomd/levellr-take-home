"""Embed every conversation with gemini-embedding-2 (768 dimensions), straight from the Gemini API.

What is embedded is the conversation's embed_text (group.py): the channel, the first line and the message texts,
without handles or timestamps, which would only add noise to the vector. It is cut at MAX_CHARS, far above the
longest one in this dataset, so the cut is a guard, not a policy. Vectors are L2-normalised here, because Gemini only
normalises the full-size output and a 768-dimension one is not unit length; the app's cosine search and its query
vectors (taskType RETRIEVAL_QUERY, same model, same dimensions, also normalised) then compare like with like.

Resumable and priced like enrich.py: vectors are appended to data/work/embeddings.jsonl keyed by conversation id + a
hash of the embedded text; every batch is checked against the budget before it is sent. The API reports no token
usage, so the charge is the chars/4 estimate at the list price.

usage (from ingest/): uv run --env-file ../.env.local python embed.py [--limit N] [--batch 100]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import time

import httpx

import budget
from build import WORK

MODEL = os.environ.get("EMBED_MODEL") or "gemini-embedding-2"
DIMS = 768
MAX_CHARS = 8000  # ~2,000 tokens, inside the model's input limit; the longest embed_text here is ~5,400 chars
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:batchEmbedContents"


def digest(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def text_of(c: dict) -> str:
    return (c.get("embed_text") or c["transcript"])[:MAX_CHARS]


def normalise(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def request_body(texts: list[str]) -> dict:
    return {"requests": [{"model": f"models/{MODEL}", "content": {"parts": [{"text": t}]},
                          "taskType": "RETRIEVAL_DOCUMENT", "outputDimensionality": DIMS} for t in texts]}


def embed_batch(client: httpx.Client, texts: list[str]) -> list[list[float]]:
    for attempt in range(6):
        r = client.post(URL, json=request_body(texts))
        if r.status_code == 200 and "embeddings" in r.json():
            return [normalise(e["values"]) for e in r.json()["embeddings"]]
        wait = 5 * 2**attempt
        print(f"  embed: HTTP {r.status_code} {r.text[:200]}; retry in {wait}s", file=sys.stderr)
        time.sleep(wait)
    raise SystemExit("embedding failed 6 times")


def run(limit: int | None, batch: int) -> None:
    convs = [json.loads(line) for line in open(WORK / "conversations.jsonl")]
    out_path = WORK / "embeddings.jsonl"
    done = set()
    if out_path.exists():
        done = {(r["id"], r["hash"]) for r in map(json.loads, open(out_path)) if r.get("model") == MODEL}
    todo = [c for c in convs if (c["id"], digest(text_of(c))) not in done]
    if limit:
        todo = todo[:limit]
    est = sum(len(text_of(c)) // 4 for c in todo)
    print(f"{MODEL}: {len(todo)} to embed, ~{est:,} tokens (~${est * budget.PRICE_PER_MTOK['embed'] / 1e6:.4f})")
    budget.check("embed", est)

    headers = {"x-goog-api-key": os.environ["GOOGLE_GENERATIVE_AI_API_KEY"]}
    with httpx.Client(headers=headers, timeout=120) as client, open(out_path, "a") as out:
        for i in range(0, len(todo), batch):
            chunk = todo[i : i + batch]
            texts = [text_of(c) for c in chunk]
            tokens = sum(len(t) // 4 for t in texts)
            budget.check("embed", tokens)
            vecs = embed_batch(client, texts)
            assert len(vecs) == len(chunk) and all(len(v) == DIMS for v in vecs), "wrong count or size of vectors"
            budget.charge("embed", tokens)
            for c, t, v in zip(chunk, texts, vecs):
                out.write(json.dumps({"id": c["id"], "hash": digest(t), "model": MODEL,
                                      "v": [round(x, 6) for x in v]}) + "\n")
            out.flush()
            print(f"  {i + len(chunk)}/{len(todo)}, ${budget.spent():.4f} spent", file=sys.stderr)
    print(f"done; total spend ${budget.spent():.4f} of ${budget.CAP_USD:.2f}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--batch", type=int, default=100)
    a = ap.parse_args()
    run(a.limit, a.batch)
