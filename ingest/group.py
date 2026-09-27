"""Messages -> conversations: the unit that gets labelled, embedded and retrieved.

A single chat message is a poor retrieval unit: "same here", "this ^" and "lol" mean nothing on their own, and the
meaning of a reply lives in what it replies to. So messages are grouped into conversations first. Citations still
point at single messages; a conversation is only the unit of search, of judgement and of counting.

Rules (the alternatives, measured on this data, are in DECISIONS.md):

1. Per channel, in time order, a new session starts wherever two messages are more than GAP_MINUTES apart.
2. A session longer than MAX_MSGS (40) messages is cut into pieces of MIN_MSGS..MAX_MSGS (20..40) messages. From the
   piece's start i, while more than MAX_MSGS messages remain, the cut goes before the message j in [i+20, i+40] with
   the longest pause since its previous message (ties: the earliest), so a piece ends where the talk paused most; the
   last piece holds the remainder (<= 40). Each piece is one conversation, every message is a member of exactly one,
   and each piece carries its session_id (the session's first message id), its piece index and n_pieces, so a
   reader can open the neighbouring pieces.
3. A reply whose parent is not a member of its conversation (the parent sits in an earlier window, or in an earlier
   session) gets that parent attached as *context*: it is shown in the transcript so the reply can be read, but it
   is not a member, so it is never counted or cited from two conversations.
4. Bots are left out of the text but kept as members, so the tree stays whole.

Counts per conversation: n_messages, n_authors (distinct account ids), n_replies (replies whose parent is in the same
conversation), n_reactions, and engagement = n_authors + n_replies + n_reactions, the measure of what resonates
(reactions alone are too sparse on this server).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime

from normalize import Message

GAP_MINUTES = 15
MIN_MSGS = 20
MAX_MSGS = 40
# A single message longer than this is cut in the transcript. The full text stays on the message row.
MSG_CHARS = 1500
TITLE_CHARS = 80


@dataclass
class Conversation:
    id: str
    ref: int  # cited as convN: position in (started_at, channel) order, 1-based
    channel: str
    kind: str  # "session"
    title: str  # the first thing said in it: what a reader would call the conversation
    member_ids: list[str]  # messages that belong here (counted and citable here)
    context_ids: list[str] = field(default_factory=list)  # parents from outside, shown for context only
    session_id: str = ""  # the session's first message id: pieces of one session share it
    piece: int = 0  # 0-based position of this piece in its session
    n_pieces: int = 1
    started_at: str = ""
    ended_at: str = ""
    n_messages: int = 0
    n_authors: int = 0
    n_replies: int = 0
    n_reactions: int = 0
    engagement: int = 0
    transcript: str = ""
    # What gets embedded: channel and title plus the message texts, without handles, names or timestamps.
    embed_text: str = ""


def _visible(m: Message) -> bool:
    return not m.is_bot


def _reactions(m: Message) -> str:
    return " ".join(f"{r['emoji']}{r['count']}" for r in m.reactions if r["count"])


def _line(m: Message, by_id: dict[str, Message]) -> str:
    when = m.ts[:16].replace("T", " ")
    text = " ".join(m.text.split())
    if len(text) > MSG_CHARS:
        text = text[:MSG_CHARS] + " …[cut; full text on the message]"
    parts = [f"[msg{m.ref}] {m.author}", when]
    parent = by_id.get(m.reply_to) if m.reply_to else None
    if parent:
        parts.append(f"reply to msg{parent.ref}")
    if m.n_reactions:
        parts.append(_reactions(m))
    return " · ".join(parts) + f": {text}"


def render(conv: Conversation, by_id: dict[str, Message]) -> str:
    lines = [f"#{conv.channel} · {conv.started_at[:16].replace('T', ' ')} to {conv.ended_at[11:16]} UTC"]
    lines += ["(context) " + _line(by_id[i], by_id) for i in conv.context_ids]
    lines += [_line(by_id[i], by_id) for i in conv.member_ids if _visible(by_id[i])]
    return "\n".join(lines)


def _finish(conv: Conversation, by_id: dict[str, Message]) -> Conversation:
    members = [by_id[i] for i in conv.member_ids]
    inside = set(conv.member_ids)
    conv.context_ids = list(dict.fromkeys(
        m.reply_to for m in members if m.reply_to and m.reply_to not in inside and m.reply_to in by_id))
    conv.started_at = members[0].ts
    conv.ended_at = members[-1].ts
    conv.n_messages = len(members)
    conv.n_authors = len({m.author_id for m in members if _visible(m)})
    conv.n_replies = sum(1 for m in members if m.reply_to in inside)
    conv.n_reactions = sum(m.n_reactions for m in members)
    conv.engagement = conv.n_authors + conv.n_replies + conv.n_reactions
    conv.transcript = render(conv, by_id)
    texts = [" ".join(m.text.split())[:MSG_CHARS] for m in members if _visible(m)]
    conv.embed_text = f"#{conv.channel}: {conv.title}\n" + "\n".join(texts)
    return conv


def _pause(a: Message, b: Message) -> float:
    return (datetime.fromisoformat(b.ts) - datetime.fromisoformat(a.ts)).total_seconds()


def pieces(ms: list[Message], lo: int = MIN_MSGS, hi: int = MAX_MSGS) -> list[list[Message]]:
    """Cut a session into pieces of lo..hi messages at the longest pause (ties: the earliest); see rule 2."""
    out: list[list[Message]] = []
    i = 0
    while len(ms) - i > hi:
        j = max(range(i + lo, i + hi + 1), key=lambda k: (_pause(ms[k - 1], ms[k]), -k))
        out.append(ms[i:j])
        i = j
    out.append(ms[i:])
    return out


def sessions(msgs: list[Message], gap_minutes: int = GAP_MINUTES) -> list[list[Message]]:
    by_channel: dict[str, list[Message]] = defaultdict(list)
    for m in sorted(msgs, key=lambda m: (m.ts, m.id)):
        by_channel[m.channel].append(m)
    out: list[list[Message]] = []
    for ms in by_channel.values():
        cur: list[Message] = []
        for m in ms:
            gap = (datetime.fromisoformat(m.ts) - datetime.fromisoformat(cur[-1].ts)).total_seconds() if cur else 0
            if cur and gap > gap_minutes * 60:
                out.append(cur)
                cur = []
            cur.append(m)
        if cur:
            out.append(cur)
    return out


def group_by_time_gap(msgs: list[Message], gap_minutes: int = GAP_MINUTES) -> list[Conversation]:
    by_id = {m.id: m for m in msgs}
    convs: list[Conversation] = []
    for ses in sessions(msgs, gap_minutes):
        opener = next((m for m in ses if _visible(m) and m.text.strip()), ses[0])
        title = " ".join(opener.text.split())[:TITLE_CHARS] or ses[0].channel
        parts = pieces(ses, MIN_MSGS, MAX_MSGS)
        for w, win in enumerate(parts):
            conv = Conversation(f"{ses[0].id}:w{w}", 0, ses[0].channel, "session", title, [m.id for m in win],
                                session_id=ses[0].id, piece=w, n_pieces=len(parts))
            convs.append(_finish(conv, by_id))
    convs.sort(key=lambda c: (c.started_at, c.channel))
    for i, c in enumerate(convs, 1):
        c.ref = i
    return convs
