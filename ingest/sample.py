"""The sample the topic suggestion reads: small, but with the same shape as the whole dataset, plus its loudest tail.

Ported from the reference (DECISIONS D46), with the channel in place of the week: this export spans two weeks, but
its 11 channels map to different products (Bushido, Tides Remastered, Hollow, the franchise), so the channel is what
a sample must not tilt. Two parts:

1. Shape. Every conversation falls in one cell of (channel) x (engagement tercile) x (length tercile). Each cell gets
   seats in proportion to its size, rounded by largest remainder so they add up exactly; conversations are drawn at
   random within a cell.
2. Tail. The rest of the seats go to the most engaged conversations the shape part did not draw, taken channel by
   channel in turn, so a small channel's loudest conversations are in front of the model too.

Engagement = the conversation's own measure (distinct authors + in-conversation replies + reactions, group.py).
Length = characters of message text. Pure and seeded: the same data and seed give the same sample.
"""

from __future__ import annotations

import random
from collections import defaultdict


def engagement(c: dict) -> int:
    return c["engagement"]


def length(c: dict) -> int:
    return len(c["embed_text"])


def terciles(values: list[float]) -> list[int]:
    """0, 1 or 2 per value, by rank: the lowest third, the middle third, the top third. Ties share a tercile."""
    order = sorted(values)
    cut1, cut2 = order[len(order) // 3], order[2 * len(order) // 3]
    return [0 if v < cut1 else 1 if v < cut2 else 2 for v in values]


def allocate(sizes: dict, seats: int) -> dict:
    """Seats per cell in proportion to its size, rounded by largest remainder so they sum to exactly `seats`."""
    total = sum(sizes.values())
    quota = {k: seats * n / total for k, n in sizes.items()}
    out = {k: int(q) for k, q in quota.items()}
    left = seats - sum(out.values())
    for k in sorted(quota, key=lambda k: (quota[k] - out[k], sizes[k]), reverse=True)[:left]:
        out[k] += 1
    return out


def sample(convs: list[dict], size: int = 300, tail_share: float = 0.2, seed: int = 7) -> list[dict]:
    """[{conversation, why: "shape" | "tail", engagement, length, channel}], shape seats first."""
    rng = random.Random(seed)
    eng_t = terciles([engagement(c) for c in convs])
    len_t = terciles([length(c) for c in convs])
    cells = defaultdict(list)
    for c, e, n in zip(convs, eng_t, len_t):
        cells[(c["channel"], e, n)].append(c)

    shape_seats = min(len(convs), round(size * (1 - tail_share)))
    seats = allocate({k: len(v) for k, v in cells.items()}, shape_seats)
    picked = []
    for key in sorted(cells):
        picked += [(c, "shape") for c in rng.sample(cells[key], seats[key])]

    taken = {c["id"] for c, _ in picked}
    by_channel = defaultdict(list)
    for c in sorted(convs, key=lambda c: (-engagement(c), c["id"])):
        if c["id"] not in taken:
            by_channel[c["channel"]].append(c)
    queues = [by_channel[ch] for ch in sorted(by_channel, key=lambda ch: -engagement(by_channel[ch][0]))]
    tail = []
    while len(tail) < size - len(picked) and any(queues):
        for q in queues:
            if q and len(tail) < size - len(picked):
                tail.append(q.pop(0))
    picked += [(c, "tail") for c in tail]
    return [{"conversation": c, "why": why, "engagement": engagement(c), "length": length(c), "channel": c["channel"]}
            for c, why in picked]


def shape_report(convs: list[dict], picked: list[dict]) -> dict:
    """The sample against the dataset, on the features it was drawn by: quartiles of engagement and length, and the
    share of each channel. The shape part should match closely; the tail shows up as a fatter top."""
    def quartiles(xs: list[int]) -> list[int]:
        xs = sorted(xs)
        return [xs[int(len(xs) * q)] for q in (0.25, 0.5, 0.75, 0.9)] if xs else []

    def channel_share(cs: list[dict]) -> dict:
        n = defaultdict(int)
        for c in cs:
            n[c["channel"]] += 1
        return {ch: round(k / len(cs), 3) for ch, k in sorted(n.items())}

    shape = [p["conversation"] for p in picked if p["why"] == "shape"]
    everything = [p["conversation"] for p in picked]
    return {
        "dataset": {"n": len(convs), "engagement_q25_50_75_90": quartiles([engagement(c) for c in convs]),
                    "length_q25_50_75_90": quartiles([length(c) for c in convs]), "channels": channel_share(convs)},
        "shape_part": {"n": len(shape), "engagement_q25_50_75_90": quartiles([engagement(c) for c in shape]),
                       "length_q25_50_75_90": quartiles([length(c) for c in shape]), "channels": channel_share(shape)},
        "whole_sample": {"n": len(everything), "engagement_q25_50_75_90": quartiles([engagement(c) for c in everything]),
                         "channels": channel_share(everything)},
    }
