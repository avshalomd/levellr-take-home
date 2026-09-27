"""The suggestion sample: exact seat count, each channel's share, the loud tail, no repeats, reproducible."""

from __future__ import annotations

from collections import Counter

from sample import allocate, sample, shape_report, terciles


def conv(i, eng=1, chars=100, channel="game-chat"):
    return {"id": f"c{i}", "engagement": eng, "embed_text": "x" * chars, "channel": channel}


def dataset():
    # Two channels, 3:1 in size; engagement and length spread so every tercile is populated.
    cs = [conv(i, eng=i % 50, chars=50 + (i * 37) % 900) for i in range(600)]
    cs += [conv(600 + i, eng=i % 40, chars=50 + (i * 53) % 900, channel="remaster") for i in range(200)]
    cs.append(conv(9999, eng=500, channel="remaster"))  # the one explosive conversation
    return cs


def test_largest_remainder_hands_out_exactly_the_seats():
    got = allocate({"a": 5, "b": 3, "c": 2}, 7)
    assert sum(got.values()) == 7 and got == {"a": 4, "b": 2, "c": 1}


def test_terciles_split_by_rank():
    assert Counter(terciles(list(range(9)))) == {0: 3, 1: 3, 2: 3}


def test_the_sample_has_exactly_the_asked_size_and_no_repeats():
    s = sample(dataset(), size=100)
    assert len(s) == 100 and len({p["conversation"]["id"] for p in s}) == 100


def test_the_shape_part_keeps_each_channels_share():
    s = sample(dataset(), size=100, tail_share=0.2)
    ch = Counter(p["channel"] for p in s if p["why"] == "shape")
    assert ch == {"game-chat": 60, "remaster": 20}  # 600 of 801 conversations -> 60 of 80 seats


def test_the_tail_takes_the_loudest_and_alternates_channels():
    tail = [p for p in sample(dataset(), size=100) if p["why"] == "tail"]
    assert "c9999" in {p["conversation"]["id"] for p in tail}
    assert Counter(p["channel"] for p in tail) == {"game-chat": 10, "remaster": 10}


def test_the_same_seed_gives_the_same_sample():
    ids = lambda s: [p["conversation"]["id"] for p in s]
    assert ids(sample(dataset(), seed=3)) == ids(sample(dataset(), seed=3))


def test_a_small_dataset_is_taken_whole():
    assert len(sample([conv(i) for i in range(10)], size=300)) == 10


def test_report_compares_the_sample_with_the_dataset():
    cs = dataset()
    r = shape_report(cs, sample(cs, size=100))
    assert r["dataset"]["n"] == len(cs) and r["shape_part"]["n"] == 80
    assert set(r["shape_part"]["channels"]) == set(r["dataset"]["channels"])
