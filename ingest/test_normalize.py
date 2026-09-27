import json

from normalize import from_discord_json, load_discord_json

RAW = {"id": "msg_000042", "community_id": "comm_1", "channel": "game-chat",
       "author": {"id": "user_0007", "name": "SilentFox"}, "timestamp": "2026-09-13T19:44:15.078Z",
       "text": "  Ebontide was great  ", "reactions": [{"emoji": "👍", "count": 2}, {"emoji": "🔥", "count": 1}],
       "reply_to": "msg_000041"}


def test_the_export_maps_to_the_message_shape():
    m = from_discord_json(RAW)
    assert (m.id, m.channel, m.reply_to, m.author, m.author_id) == (
        "msg_000042", "game-chat", "msg_000041", "SilentFox", "user_0007")
    assert m.ts == "2026-09-13T19:44:15.078000+00:00" and m.text == "Ebontide was great"
    assert m.n_reactions == 3 and m.reactions[0] == {"emoji": "👍", "count": 2}
    assert not m.is_bot


def test_no_reactions_and_no_parent():
    m = from_discord_json({**RAW, "reactions": [], "reply_to": None})
    assert m.n_reactions == 0 and m.reactions == [] and m.reply_to is None


def test_bots_come_from_the_manifest():
    assert from_discord_json(RAW, {"SilentFox"}).is_bot


def test_load_sorts_by_time_and_reuses_the_export_number_as_ref(tmp_path):
    later = {**RAW, "id": "msg_000050", "timestamp": "2026-09-14T00:00:00Z"}
    earlier = {**RAW, "id": "msg_000003", "timestamp": "2026-09-13T00:00:00Z"}
    f = tmp_path / "m.json"
    f.write_text(json.dumps([later, earlier]))
    ms = load_discord_json(f)
    assert [(m.id, m.ref) for m in ms] == [("msg_000003", 3), ("msg_000050", 50)]


def test_ref_falls_back_to_position_when_ids_are_not_numbered(tmp_path):
    f = tmp_path / "m.json"
    f.write_text(json.dumps([{**RAW, "id": "abc"}, {**RAW, "id": "xyz", "timestamp": "2026-09-14T00:00:00Z"}]))
    assert [m.ref for m in load_discord_json(f)] == [1, 2]
