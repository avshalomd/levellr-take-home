"""data/work/* -> Neon Postgres. Drops and rebuilds the data tables: the database is a build output, never hand-edited.

Adapted from the reference. Bulk-loads with COPY (one round trip per table instead of one per row), derives topic
membership in SQL (pulse_topics, db/schema.sql), builds the indexes, writes dataset_meta, then checks the counts that
went in against the counts that came out.

Labels are optional: before enrich.py has run (or before topics are approved) conversations load with NULL labels, and
a later run fills them. A label row is used only when it was made from this transcript (hash) with the current
question set (qhash), so a stale label never lands on changed data. The reference's label-set carry-over (a customer's
edited taxonomy surviving a rebuild) is left out: there is no in-app topic editing in this build yet.

usage (from ingest/): uv run --env-file ../.env.local python load.py   (DATABASE_URL_UNPOOLED: COPY wants a direct
connection, not the pooler)
"""

from __future__ import annotations

import json
import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import psycopg

import budget
import embed
import enrich
from build import WORK
from flags import FLAGS

ROOT = Path(__file__).resolve().parent.parent


def read_jsonl(name: str) -> list[dict]:
    path = WORK / name
    return [json.loads(line) for line in open(path)] if path.exists() else []


def approved_topics() -> dict | None:
    path = WORK / "topics.json"
    return enrich.load_topics(path) if path.exists() else None


def usable_labels(rows: list[dict], convs: list[dict], qhash: str | None) -> dict[str, dict]:
    """The label row for each conversation, only when it was asked of this transcript with this question set.
    A later row for the same conversation wins (a re-run appends)."""
    if qhash is None:
        return {}
    hashes = {c["id"]: enrich.digest(c["transcript"]) for c in convs}
    out: dict[str, dict] = {}
    for r in rows:
        if r.get("qhash") == qhash and hashes.get(r["id"]) == r["hash"]:
            out[r["id"]] = r
    return out


def usable_vectors(rows: list[dict], convs: list[dict]) -> dict[str, list[float]]:
    hashes = {c["id"]: embed.digest(embed.text_of(c)) for c in convs}
    return {r["id"]: r["v"] for r in rows if r.get("model") == embed.MODEL and hashes.get(r["id"]) == r["hash"]}


def meta_of(msgs: list[dict], convs: list[dict], source: dict, accepted: dict | None, labels: dict, vectors: dict) -> dict:
    by_channel = Counter(m["channel"] for m in msgs)
    convs_by_channel = Counter(c["channel"] for c in convs)
    return {
        "source": {"platform": "Discord", "community": source["community"], "about": source["about"],
                   "via": source.get("via", ""), "authors": source.get("authors", ""),
                   "media": "text and metadata only (reactions as counts); attachments are not in the export"},
        "window": {"from": msgs[0]["ts"], "to": msgs[-1]["ts"]},
        # "now" for relative questions ("this week") is the last message, not the wall clock: the data is a snapshot.
        "now": msgs[-1]["ts"],
        "counts": {"messages": len(msgs), "conversations": len(convs),
                   "authors": len({m["author_id"] for m in msgs}),
                   "replies": sum(1 for m in msgs if m["reply_to"]),
                   "reactions": sum(m["n_reactions"] for m in msgs),
                   "labelled": len(labels), "embedded": len(vectors)},
        "channels": [{"channel": ch, "messages": n, "conversations": convs_by_channel[ch]}
                     for ch, n in by_channel.most_common()],
        "topics": [{"key": l["key"], "name": l["name"], "description": l["description"]}
                   for l in (accepted or {}).get("labels", [])],
        "mood_target": enrich.mood_target(accepted) if accepted else None,
        "flags": FLAGS,
        "sentiment_levels": enrich.SENTIMENT_LEVELS,
        "topic_question": enrich.TOPIC_QUESTION,
        "label_model": next((r["model"] for r in labels.values()), None),
        "models": {"labels": enrich.MODEL, "embeddings": f"{embed.MODEL} ({embed.DIMS} dims)"},
        "spend_usd": round(budget.spent(), 4),
        "built_at": datetime.now(timezone.utc).isoformat(),
    }


def vec_literal(v: list[float] | None) -> str | None:
    return "[" + ",".join(map(str, v)) + "]" if v else None


def main() -> None:
    msgs = sorted(read_jsonl("messages.jsonl"), key=lambda m: (m["ts"], m["id"]))
    convs = read_jsonl("conversations.jsonl")
    conv_of = json.load(open(WORK / "conversation_of.json"))
    source = json.load(open(WORK / "source.json"))
    accepted = approved_topics()
    qhash = enrich.qhash(enrich.questions(accepted["labels"]), enrich.mood_target(accepted)) if accepted else None
    labels = usable_labels(read_jsonl("labels.jsonl"), convs, qhash)
    vectors = usable_vectors(read_jsonl("embeddings.jsonl"), convs)

    with psycopg.connect(os.environ["DATABASE_URL_UNPOOLED"]) as db, db.cursor() as cur:
        cur.execute((ROOT / "db" / "schema.sql").read_text())

        with cur.copy("COPY messages (id, ref, channel, reply_to, conversation_id, author, author_id, ts, text,"
                      " reactions, n_reactions) FROM STDIN") as cp:
            for m in msgs:
                cp.write_row((m["id"], m["ref"], m["channel"], m["reply_to"], conv_of[m["id"]], m["author"],
                              m["author_id"], m["ts"], m["text"], json.dumps(m["reactions"], ensure_ascii=False),
                              m["n_reactions"]))

        with cur.copy("COPY conversations (id, ref, channel, kind, started_at, ended_at, n_messages, n_authors,"
                      " n_replies, n_reactions, engagement, context_ids, transcript, topic_p, sentiment, p_excited,"
                      " p_frustrated, p_bug, p_feature, p_help, p_noise, labels, label_model, embedding) FROM STDIN") as cp:
            for c in convs:
                lab = labels.get(c["id"])
                cp.write_row((
                    c["id"], c["ref"], c["channel"], c["kind"], c["started_at"], c["ended_at"], c["n_messages"],
                    c["n_authors"], c["n_replies"], c["n_reactions"], c["engagement"], c["context_ids"], c["transcript"],
                    *((json.dumps(lab["topic_p"]), lab["sentiment"], *(lab[f"p_{f}"] for f in FLAGS),
                       json.dumps({"sentiment": lab["raw"]["sentiment"], "sentiment_conf": lab["sentiment_conf"]}),
                       lab["model"]) if lab else (None,) * (4 + len(FLAGS))),
                    vec_literal(vectors.get(c["id"])),
                ))

        cur.execute("UPDATE conversations SET topics = pulse_topics(topic_p), topic = (pulse_topics(topic_p))[1],"
                    " topic_conf = pulse_topic_conf(topic_p) WHERE topic_p IS NOT NULL")

        with cur.copy("COPY dataset_meta (key, value) FROM STDIN") as cp:
            for k, v in meta_of(msgs, convs, source, accepted, labels, vectors).items():
                cp.write_row((k, json.dumps(v, ensure_ascii=False)))

        cur.execute((ROOT / "db" / "indexes.sql").read_text())
        cur.execute("SELECT (SELECT count(*) FROM messages), (SELECT count(*) FROM conversations),"
                    " (SELECT count(*) FROM conversations WHERE topic_p IS NOT NULL),"
                    " (SELECT count(*) FROM conversations WHERE embedding IS NOT NULL)")
        n_msgs, n_convs, n_lab, n_emb = cur.fetchone()
        db.commit()

    assert (n_msgs, n_convs) == (len(msgs), len(convs)), "row counts do not match the files"
    print(f"loaded {n_msgs} messages, {n_convs} conversations ({n_lab} labelled, {n_emb} embedded)"
          f"{'' if accepted else '; no topics.json, so no labels'}")


if __name__ == "__main__":
    main()
