"""The loader keeps only labels and vectors made from the data it loads, and states the dataset's facts from code."""

from __future__ import annotations

import pytest

import embed
import enrich
from flags import FLAGS
from load import meta_of, usable_labels, usable_vectors

CONV = {"id": "c1", "channel": "game-chat", "transcript": "[msg1] A: hi", "embed_text": "#game-chat: hi\nhi"}
TOPICS = [{"key": "tides-remastered", "name": "Tides Remastered", "description": "The remaster."}]


def test_a_label_is_used_only_for_the_same_transcript_and_question_set():
    qh = enrich.qhash(enrich.questions(TOPICS))
    good = {"id": "c1", "hash": enrich.digest(CONV["transcript"]), "qhash": qh}
    stale_text = {**good, "hash": "0" * 16}
    stale_questions = {**good, "qhash": "other"}
    assert usable_labels([good], [CONV], qh) == {"c1": good}
    assert usable_labels([stale_text, stale_questions], [CONV], qh) == {}
    assert usable_labels([good], [CONV], None) == {}  # no approved topics: load without labels


def test_a_later_label_row_wins():
    qh = "q"
    h = enrich.digest(CONV["transcript"])
    first, second = {"id": "c1", "hash": h, "qhash": qh, "n": 1}, {"id": "c1", "hash": h, "qhash": qh, "n": 2}
    assert usable_labels([first, second], [CONV], qh)["c1"]["n"] == 2


def test_a_vector_is_used_only_for_the_same_text_and_model():
    h = embed.digest(embed.text_of(CONV))
    assert usable_vectors([{"id": "c1", "hash": h, "model": embed.MODEL, "v": [1.0]}], [CONV]) == {"c1": [1.0]}
    assert usable_vectors([{"id": "c1", "hash": h, "model": "other", "v": [1.0]}], [CONV]) == {}
    assert usable_vectors([{"id": "c1", "hash": "x", "model": embed.MODEL, "v": [1.0]}], [CONV]) == {}


def test_now_is_the_last_message_not_the_wall_clock():
    msgs = [{"ts": "2026-09-13T19:44:15+00:00", "channel": "a", "author_id": "u1", "reply_to": None, "n_reactions": 2},
            {"ts": "2026-09-27T19:30:00+00:00", "channel": "b", "author_id": "u2", "reply_to": "m1", "n_reactions": 0}]
    src = {"community": "X", "about": "y"}
    meta = meta_of(msgs, [{"channel": "a"}], src, {"labels": TOPICS}, {}, {})
    assert meta["now"] == "2026-09-27T19:30:00+00:00"
    assert meta["window"] == {"from": msgs[0]["ts"], "to": msgs[-1]["ts"]}
    assert meta["counts"]["authors"] == 2 and meta["counts"]["replies"] == 1 and meta["counts"]["reactions"] == 2
    assert [c["channel"] for c in meta["channels"]] == ["a", "b"]
    assert meta["topics"][0]["key"] == "tides-remastered"
    assert meta_of(msgs, [], src, None, {}, {})["topics"] == []


def test_every_flag_and_topic_is_one_question():
    qs = enrich.questions(TOPICS)
    assert set(qs) == {"sentiment", *FLAGS, "topic_tides_remastered"}
    assert qs["sentiment"]["type"] == "score" and all(qs[f]["type"] == "noul" for f in FLAGS)


def test_enrich_refuses_to_run_without_approved_topics(tmp_path):
    with pytest.raises(SystemExit, match="no approved topics"):
        enrich.load_topics(tmp_path / "topics.json")


def test_a_jev_answer_becomes_a_row_of_probabilities():
    answers = {"sentiment": {"type": "score", "score": 1.0, "confidence": 0.9, "probabilities": {"1": 1.0}},
               **{f: {"type": "noul", "noul": 0.25} for f in FLAGS},
               "topic_tides_remastered": {"type": "noul", "noul": 0.8}}
    row = enrich.to_row("c1", "h", "q", TOPICS, {"model": "jev", "answers": answers,
                                                 "usage": {"input_tokens": 10, "cost": 1e-6}})
    assert row["sentiment"] == 0.25  # position 1 of 0..4
    assert row["topic_p"] == {"tides-remastered": 0.8}
    assert all(row[f"p_{f}"] == 0.25 for f in FLAGS)
    assert row["cost"] == 1e-6
