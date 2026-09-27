"""Read the sample and suggest (a) the topics to label every conversation with and (b) what the mood is about.

Why an LLM here and Jev everywhere else: proposing categories is
open-ended writing, which Jev does not do; applying them to every conversation is a closed judgment repeated, which is
Jev's job (DECISIONS D17, D46). The model is Gemini Flash-Lite on the brief's key, one call.

Topics may overlap: each becomes its own yes/no question, so the model is asked for what a Community & Marketing
manager would want to track, not for a mutually exclusive taxonomy. Each topic is ONE neutral subject; feelings and
kinds of message have their own axes (sentiment, flags.py), so a topic must not rebuild them.

The model also lists, per topic, which sampled conversations belong to it, so the share of the sample each topic
covers is counted from its own assignments instead of being guessed.

usage (from ingest/, after build.py):
  uv run --env-file ../.env.local python suggest.py        # writes data/work/sample.json and suggested.json
"""

from __future__ import annotations

import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone

import httpx

import budget
import sample as S
from build import WORK
from flags import FLAGS

MODEL = os.environ.get("SUGGEST_MODEL", "gemini-3.5-flash-lite")
# Pre-call estimate only, USD per million tokens; the ledger records the tokens Google reports.
USD_PER_MTOK = {"in": 0.10, "out": 0.40}
URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
EXCERPT = 600  # characters of message text per sampled conversation: enough to see what it is about
SIZE = 300

SCHEMA = {
    "type": "object",
    "required": ["labels", "mood_target"],
    "properties": {
        "labels": {
            "type": "array", "minItems": 10, "maxItems": 14,
            "items": {
                "type": "object", "required": ["name", "description", "conversations"],
                "properties": {
                    "name": {"type": "string", "description": "1-3 plain words naming ONE subject"},
                    "description": {"type": "string", "description": "one sentence: what belongs here, and what does "
                                    "not when it is easily confused with another topic"},
                    "conversations": {"type": "array", "items": {"type": "integer"},
                                      "description": "the number of EVERY sampled conversation [cN] that belongs here"},
                },
            },
        },
        "mood_target": {
            "type": "object", "required": ["target", "why", "alternatives"],
            "properties": {
                "target": {"type": "string", "description": "what or whom the community's feelings are mostly about"},
                "why": {"type": "string", "description": "one sentence of evidence from the sample"},
                "alternatives": {"type": "array", "items": {"type": "string"},
                                 "description": "other targets a big share of the conversations react to; empty if none"},
            },
        },
    },
}

SYSTEM = (
    "You set up a community-insights tool for a game studio's Community & Marketing manager. From a sample of the "
    "community's Discord conversations you propose (1) the topics the manager should track and (2) what the "
    "community's mood is about.\n"
    "Topics: 10 to 14. Each topic is ONE subject people talk about, named neutrally in 1-3 plain words, with a "
    "one-sentence definition of what is in and what is not. Every topic is asked about on its own as a yes/no "
    "question, and a conversation can belong to several, so:\n"
    "- Never join two subjects in one topic. Use 'and' only when both words name the same thing.\n"
    "- Prefer the concrete things this community names (a game, an update, a mode, a quest, an event, a platform) "
    "over generic categories, when enough conversations are about them.\n"
    "- A topic is a subject, not a feeling or a kind of message. How people feel is measured separately (sentiment "
    "towards the mood target), and these kinds of conversation are already flagged separately, so never make a topic "
    "out of them: {flags}.\n"
    "- Two topics must never mean the same thing, but they may overlap where subjects naturally meet.\n"
    "Cover the everyday traffic and make sure the loudest conversations (high engagement) are covered too. Do not "
    "propose an 'Other' topic; it is added automatically. For each topic list the numbers of all sampled "
    "conversations that belong to it.\n"
    "Mood target: the sentiment of every conversation will be measured towards ONE target. Name what the people in "
    "this community mostly react to, concretely. If a large share reacts to something else, list it under "
    "alternatives."
)


def slug(name: str) -> str:
    """Same rule as the app's taxonomy slug(), so keys made here and in the app look alike."""
    s = unicodedata.normalize("NFKD", name.lower())
    s = re.sub(r"[^\w]+", "-", s, flags=re.UNICODE).replace("_", "-").strip("-")
    return s[:40] or "label"


def normalize(labels: list[dict], n_sample: int) -> list[dict]:
    """Unique keys, "other" dropped from the model's list and appended last (Jev must be allowed to say none fits),
    and the share of the sample each topic was given, counted from the model's own assignments."""
    out, used = [], set()
    for l in labels:
        name = l["name"].strip()
        key = slug(name)
        if not name or key == "other":
            continue
        base, i = key, 2
        while key in used:
            key, i = f"{base}-{i}", i + 1
        used.add(key)
        members = sorted({n for n in l.get("conversations") or [] if 0 <= n < n_sample})
        out.append({"key": key, "name": name, "description": l["description"].strip(),
                    "sample_share": round(len(members) / n_sample, 3), "sample_members": members})
    return out + [{"key": "other", "name": "Other", "description": "None of the other topics fits."}]


def line(i: int, p: dict) -> str:
    c = p["conversation"]
    body = c["embed_text"].split("\n", 1)[-1]  # the messages, without the title line that repeats the first one
    text = re.sub(r"\s+", " ", body)[:EXCERPT]
    return f"[c{i}] (engagement {p['engagement']}, {c['n_messages']} messages) #{c['channel']}: {text}"


def prompt(community: str, about: str, picked: list[dict]) -> str:
    return (f"Community: {community}, {about}.\n\n{len(picked)} sampled conversations, each as [cN] (engagement, "
            f"size) #channel: the messages:\n\n" + "\n".join(line(i, p) for i, p in enumerate(picked)))


def system() -> str:
    return SYSTEM.format(flags="; ".join(f"{k} ({v.split('?')[0]})" for k, v in FLAGS.items()))


def suggest(community: str, about: str, picked: list[dict]) -> dict:
    body = {
        "systemInstruction": {"parts": [{"text": system()}]},
        "contents": [{"role": "user", "parts": [{"text": prompt(community, about, picked)}]}],
        "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json", "responseJsonSchema": SCHEMA},
    }
    est_in = len(json.dumps(body)) // 4
    budget.check("llm", est_in + 4000)
    with httpx.Client(timeout=300) as client:
        r = client.post(URL.format(model=MODEL), json=body,
                        headers={"x-goog-api-key": os.environ["GOOGLE_GENERATIVE_AI_API_KEY"]})
    if r.status_code != 200:
        raise SystemExit(f"suggestion failed: HTTP {r.status_code} {r.text[:400]}")
    d = r.json()
    usage = d.get("usageMetadata") or {}
    tin = int(usage.get("promptTokenCount") or est_in)
    tout = int(usage.get("candidatesTokenCount") or 0) + int(usage.get("thoughtsTokenCount") or 0)
    usd = (tin * USD_PER_MTOK["in"] + tout * USD_PER_MTOK["out"]) / 1e6
    budget.charge("llm", tin + tout, usd)
    answer = json.loads(d["candidates"][0]["content"]["parts"][0]["text"])
    return {
        "labels": normalize(answer["labels"], len(picked)),
        "mood_target": answer["mood_target"],
        "model": MODEL,
        "usd_estimate": round(usd, 5),
        "tokens": {"in": tin, "out": tout},
        "at": datetime.now(timezone.utc).isoformat(),
    }


def main(size: int = SIZE) -> None:
    convs = [json.loads(l) for l in open(WORK / "conversations.jsonl")]
    picked = S.sample(convs, size=size)
    report = S.shape_report(convs, picked)
    ids = [p["conversation"]["id"] for p in picked]
    (WORK / "sample.json").write_text(json.dumps({"ids": ids, "why": [p["why"] for p in picked], "report": report},
                                                 ensure_ascii=False, indent=1))
    for part in ("dataset", "shape_part", "whole_sample"):
        r = report[part]
        print(f"{part:12} n={r['n']:>5}  engagement q25/50/75/90 {r['engagement_q25_50_75_90']}  channels {r['channels']}")

    src = json.load(open(WORK / "source.json"))
    out = suggest(src["community"], src["about"], picked)
    for l in out["labels"]:
        l["sample_members"] = [ids[i] for i in l.get("sample_members", [])]
    out["sample"] = {"size": len(picked), "shape": sum(p["why"] == "shape" for p in picked),
                     "tail": sum(p["why"] == "tail" for p in picked)}
    (WORK / "suggested.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    mt = out["mood_target"]
    print(f"\nmood target: {mt['target']}\n  why: {mt['why']}\n  alternatives: {mt['alternatives'] or 'none'}")
    for l in out["labels"]:
        share = f"{l['sample_share']:.0%}" if "sample_share" in l else "-"
        print(f"- {l['name']} [{share} of sample]: {l['description']}")
    print(f"\n{out['model']}: {out['tokens']['in']:,} tokens in, {out['tokens']['out']:,} out, "
          f"~${out['usd_estimate']:.4f}")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else SIZE)
