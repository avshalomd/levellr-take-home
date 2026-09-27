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
- A **conversation** row is a piece of a channel session (15-minute pauses; a session over 40 messages is cut at the
  longest pause 20-40 messages in, again and again; the last piece holds the remainder, so 51 of the 553 cut pieces
  are under 20). It is the unit of retrieval, labels and counts. It carries the time of its first and last
  message.
- The agent **cannot count**: anything outside these 11 channels (Reddit, Steam, sales, revenue), anything before
  09-13 19:44Z, people who read without writing, reactions as a measure of reach (too sparse), or what people intend
  beyond their words. A count over conversations is not a count of people or of messages, and the answer says which
  one it is.

## Label audit

Read by hand on the final labels (v4 wording) in Neon. **Sample:** 30 conversations drawn by
`md5(id || 'audit-2026-09-27')`, 10 from each size band (1-3 messages, 4-19, 20-40), plus 10 drawn at random from
`pricing-and-editions` (its share rose, below). A label counts at p >= 0.5, as in the app. Judged by the coding
agent reading each transcript, not by the human; borderline calls were given to the label.

| axis (30 stratified) | right | what went wrong |
|---|---|---|
| topics (the set at p >= 0.5) | **21/30** | 6 miss a clear topic (Domains, Ebontide, Tides Remastered, classic games, RPG-era), 4 carry a wrong `pricing-and-editions`, 1 a wrong `series-direction` |
| flags, each one that fired | **37/41** | `feature` on a passing opinion, `frustrated` on a quarrel about indie games (not about VoA), `help` on a question that sat in a context message, `noise` on a one-line story remark |
| flags, whole conversation (no false flag, none missed) | **24/30** | the 4 above, plus 2 misses: an answered achievement question with no `help`, a "just need weapons like these" with no `feature` |
| sentiment direction (< 0.4 negative, > 0.6 positive, else neutral) | **30/30** | none; most scores sit in the neutral band, so direction is the easy part |

**Pricing is over-assigned.** 5 of the 10 random `pricing-and-editions` conversations are right (a sale to wait for,
Steam prices, a paid XP boost in the store, a shop set, saving up for a PS5 and two games); 5 are wrong. In the
stratified 30 it fired 9 times, 5 right. It fires on:

- **any buying word in passing:** "bought the fishscale Domain reskin, its broken" (a bug report), "I bought the 007
  controller" (hardware, another franchise), PS Plus rules for co-op in other games;
- **idiom:** "too much value for my money" in an argument about a game's length;
- **"DLC" as a name:** "it's a good DLC" in a Domains run;
- **in-game currency earned by playing:** Domains store credits, Fjord's special currency;
- **a context message:** a reply parent shown for context ("am I gonna have to buy Bushido to get the outfit") made
  a 25-message lore conversation pricing.

**Why the share rose from 11.9% to 15.9%.** The stricter description added a list: "prices, costs, editions,
purchases, sales, DLC value or store items". Of the 375 pricing conversations, 280 were pricing before and 95 are new
(1 dropped). The 95 new ones are long (median 20 messages, against 4 overall), 76 of them hold a buying word in a
member message ("buy" in 25, "store" 15, "DLC" 13, "bought" 13, "shop" 12), 7 only in a context message, 12 none at
all. Jev reads the list as trigger words: naming "purchases" and "store items" made any purchase or in-game store
count, and a long conversation almost always has one. A fix would say what does not count (in-game currency, hardware,
other franchises, passing mentions); not relabelled tonight, so pricing counts should be read as an upper bound.

**What this means for the agent.** Counts by topic lean on labels that are right about 7 times in 10 at the set
level; flag slices are sharper (9 in 10 of fired flags right). `scan` re-reads every conversation in a slice with Jev
against the question, so a wrong label costs a read, not a wrong answer; the counts `aggregate` returns are label
counts, and the pricing one runs high.
