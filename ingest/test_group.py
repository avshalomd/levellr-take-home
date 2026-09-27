"""Grouping rules, one test per rule in group.py's docstring."""

from __future__ import annotations

import group
from group import group_by_time_gap
from normalize import Message


def msg(n, minute=0, reply_to=None, channel="game-chat", text="hello", author="a", reactions=0, bot=False):
    return Message(
        id=f"m{n}", ref=n, channel=channel, reply_to=reply_to, author=author, author_id="id-" + author,
        ts=f"2026-09-20T{10 + minute // 60:02d}:{minute % 60:02d}:00+00:00", text=text, n_reactions=reactions,
        reactions=[{"emoji": "👍", "count": reactions}] if reactions else [], is_bot=bot,
    )


def members(convs):
    return [c.member_ids for c in convs]


def test_sessions_split_on_a_gap_over_15_minutes_per_channel():
    ms = [msg(1, 0), msg(2, 15), msg(3, 31), msg(4, 5, channel="off-topic")]
    assert members(group_by_time_gap(ms)) == [["m1", "m2"], ["m4"], ["m3"]]


def test_long_sessions_are_cut_into_windows_of_30():
    ms = [msg(i, i) for i in range(1, 66)]
    assert [len(c.member_ids) for c in group_by_time_gap(ms)] == [30, 30, 5]


def test_every_message_is_a_member_of_exactly_one_conversation():
    ms = [msg(i, i * 7 % 200, channel=["a", "b"][i % 2]) for i in range(1, 120)]
    ids = [i for c in group_by_time_gap(ms) for i in c.member_ids]
    assert sorted(ids) == sorted(m.id for m in ms)


def test_a_parent_in_an_earlier_window_is_context_not_member(monkeypatch):
    monkeypatch.setattr(group, "MAX_MSGS", 2)
    ms = [msg(1, 0), msg(2, 1), msg(3, 2, reply_to="m1"), msg(4, 3, reply_to="m3")]
    convs = group_by_time_gap(ms)
    assert members(convs) == [["m1", "m2"], ["m3", "m4"]]
    assert convs[1].context_ids == ["m1"] and convs[1].n_replies == 1  # m4 -> m3 counts, m3 -> m1 does not
    assert "(context) [msg1]" in convs[1].transcript


def test_a_parent_in_an_earlier_session_is_context_too():
    convs = group_by_time_gap([msg(1, 0), msg(2, 60, reply_to="m1")])
    assert convs[1].context_ids == ["m1"] and convs[1].member_ids == ["m2"]


def test_counts_and_engagement():
    ms = [msg(1, 0, author="a", reactions=2), msg(2, 1, author="b", reply_to="m1"), msg(3, 2, author="a", reply_to="m2")]
    c = group_by_time_gap(ms)[0]
    assert (c.n_messages, c.n_authors, c.n_replies, c.n_reactions) == (3, 2, 2, 2)
    assert c.engagement == 2 + 2 + 2


def test_transcript_lines_carry_ref_author_time_reply_and_reactions():
    ms = [msg(1, 0, text="Domains   are\nfun", reactions=3), msg(2, 5, reply_to="m1", author="b")]
    t = group_by_time_gap(ms)[0].transcript.splitlines()
    assert t[0] == "#game-chat · 2026-09-20 10:00 to 10:05 UTC"
    assert t[1] == "[msg1] a · 2026-09-20 10:00 · 👍3: Domains are fun"
    assert t[2] == "[msg2] b · 2026-09-20 10:05 · reply to msg1: hello"


def test_bots_are_members_but_not_in_the_text():
    c = group_by_time_gap([msg(1, 0), msg(2, 1, bot=True, text="Welcome!")])[0]
    assert c.member_ids == ["m1", "m2"] and "Welcome!" not in c.transcript and c.n_authors == 1


def test_conversations_are_numbered_in_time_order_and_titled_by_their_opener():
    convs = group_by_time_gap([msg(1, 40, channel="b", text="later"), msg(2, 0, text="first thing said")])
    assert [(c.ref, c.title) for c in convs] == [(1, "first thing said"), (2, "later")]
