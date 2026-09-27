# The data

`data/messages.json`, sent with the brief. Kept out of git (`.gitignore`); the pipeline in `ingest/` reads it from
there. Every number below was measured on this file tonight, not carried over from the rehearsal.

## Profile

| | |
|---|---|
| messages | 25,555 |
| communities | 1 (`comm_1`) |
| span | 2026-09-13 19:44Z to 2026-09-27 19:30Z (two weeks, all timestamps UTC) |
| "now" | the last message, 2026-09-27 19:30Z: "the last 3 days" = 09-24 19:30Z to 09-27 19:30Z |
| channels | 11 |
| authors | 795, pseudonymous handles; no bots |
| replies | 37% of messages have `reply_to`; a reply never crosses channels |
| reactions | on 4.5% of messages; the most any message has is 8 |
| text | short: median 40 characters. Links are replaced by `[link]`, spoilers are `\|\|...\|\|` |
| permalinks | none in the export, so citations open the message in the app, not in Discord |

### Channels

| channel | messages | what it is about |
|---|---|---|
| game-chat | 7,071 | the franchise in general |
| off-topic | 6,378 | anything |
| new-release-discussion | 6,042 | Bushido, the current game |
| remaster-discussion | 2,233 | Tides Remastered, upcoming |
| new-release-spoilers | 1,725 | Bushido, spoilers |
| rpg-chat | 1,158 | the RPG-era games |
| spoilers | 292 | spoilers, any game |
| remaster-spoilers | 289 | Tides Remastered, spoilers |
| franchise-discussion | 254 | the series |
| looking-for-group | 108 | co-op partners |
| upcoming-releases | 5 | Hollow and later games |

### The domain

The game is a renamed Assassin's Creed, "Veil of Ages". In this window:

- **Bushido** is the current game. It got its final content update (Title Update 1.1.11) on update night, 09-17 into
  09-18 UTC: the **Ebontide** story quest and the **Domains** rogue-lite mode.
- **Tides Remastered** is an upcoming remaster; its channels discuss previews and what changed from the original.
- **Hollow** is an upcoming game, mostly rumours.

## Shape of the conversation

This decides the unit (DECISIONS.md, the unit).

- **Long sessions dominate.** Split each channel at 15-minute pauses: 159 sessions have more than 30 messages, and
  they hold 67% of all messages. The largest is 1,054 messages from 98 authors over 12 hours, on update night.
- **Long sessions are of two kinds.** Dialogues: 68 of them have two people writing at least 60% of the messages.
  Crowds: 29 have 15 or more authors.
- **Typically one active reply thread at a time**, so reply trees do not separate parallel conversations the way
  they would on a busy forum.
- **The subject drifts about every 30 minutes** inside a long session, which is why a long session is cut into
  pieces rather than read as one conversation.

## What one row is, and what the agent cannot count

- A **message** row is one Discord message, with its channel, author, UTC time, reactions and reply parent. It is the
  unit of citation.
- A **conversation** row is a piece of a channel session (15-minute pauses; long sessions cut into 20-40-message pieces
  at their longest pause). It is the unit of retrieval, labels and counts. It carries the time of its first and last
  message.
- The agent **cannot count**: anything outside these 11 channels (Reddit, Steam, sales, revenue), anything before
  09-13 19:44Z, people who read without writing, reactions as a measure of reach (too sparse), or what people intend
  beyond their words. A count over conversations is not a count of people or of messages, and the answer says which
  one it is.

## Label audit

TODO: about 30 conversations drawn by `md5(id)`, read by hand against their Jev labels (topic, sentiment, excited,
frustrated). Result goes here and in the README.
