# The data

`data/messages.json`, sent with the brief. Kept out of git (`.gitignore`); the pipeline in `ingest/` reads it from
there. Every number below was measured on this file.

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

**Dates written inside messages do not match the timestamps.** A message stamped 2026-09-27 says "Today is 25th of
June", and Tides Remastered's launch is "July 9th" in messages stamped 09-18 to 09-27, while "now" is 27
September. The brief's sample shows `msg_000054` at 2026-06-22 11:00Z; the export stamps the same message 2026-09-13
21:09Z. The timestamps look shifted forward by about three months. The app trusts the timestamps
([DECISIONS.md, D2](../DECISIONS.md#d2-now-is-the-last-message)), so a date quoted from a message can contradict the
window it sits in ([QA.md](QA.md), P8).

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

This decides the unit ([DECISIONS.md, D3](../DECISIONS.md#d3-the-unit-pause-split-sessions-long-ones-cut-at-the-best-silence-the-humans-rule)).

- **Long sessions dominate.** Split each channel at 15-minute pauses: 159 sessions have more than 30 messages, and
  they hold 67% of all messages. The largest is 1,054 messages from 98 authors over 12 hours, on update night.
- **Long sessions are of two kinds.** Dialogues: 68 of them have two people writing at least 60% of the messages.
  Crowds: 29 have 15 or more authors.
- **Typically one active reply thread at a time**, so reply trees do not separate parallel conversations the way
  they would on a busy forum.
- **The subject drifts about every 30 minutes** inside a long session, which is why a long session is cut into
  pieces rather than read as one conversation.

## What one row is, and what the agent cannot count

In the README: [The unit, and what it cannot count](../README.md#the-unit-and-what-it-cannot-count).

## Label audit

Read by hand on the v4 labels in Neon, before the pricing fix (DECISIONS D23). **Sample:** 30 conversations drawn by
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
count, and a long conversation almost always has one.

**Fixed after the audit** (DECISIONS D23): the description now says the price or value must itself be the subject and
names what does not count, and every conversation was relabelled. Pricing fell to 7.3%. On a 40-conversation check,
about 10 of the 13 it kept are right; the new labels were not re-audited at scale.

**What this means for the agent.** Counts by topic lean on labels that are right about 7 times in 10 at the set
level; flag slices are sharper (9 in 10 of fired flags right). `scan` re-reads every conversation in a slice with Jev
against the question, so a wrong label costs a read, not a wrong answer; the counts `aggregate` returns are label
counts, and topic counts run low where a clear topic is missed.

## Label set

Final labels, 2,362 conversations, a label counting at p >= 0.5. Every conversation is labelled once by Jev
(DECISIONS D6): a yes/no probability per topic, sentiment, and six flags. Shares are measured in Neon after the
pricing fix (D23). A conversation can carry several topics and flags, so the shares do not sum to 100%; "other" means
no topic reached 0.5.

**Topics** (`data/work/topics.json`)

| topic | key | description | share |
|---|---|---|---|
| Lore and story | `lore-and-story` | The series' narrative, characters, historical settings and modern-day plot, discussed as story. Not gameplay, builds or difficulty that happen to name a character (Kano and Hana are playable characters). | 17.7% |
| Other games | `other-games-off-topic` | Other franchises (GTA, Witcher, etc.), general gaming news, and gaming or PC-hardware talk that is not about Veil of Ages. | 17.1% |
| Series direction | `series-direction` | Only when people argue about where the franchise is going or compare the games as a whole (stealth versus RPG, rankings, tier lists, the studio's choices). Not every mention of an older game. | 13.1% |
| Classic games | `classic-games` | Playing the older titles such as Bastion, Legion, Requiem, Empire and the original Tides. | 10.7% |
| Tides Remastered | `tides-remastered` | The upcoming Tides Remastered: reveals, trailers, changes from the original Tides, release date, pre-orders, the Twitch drop. | 10.0% |
| Domains | `domains` | Bushido's rogue-lite Domains mode: difficulty tiers, domain bosses, runs, builds, perks and gear for Domains. | 9.4% |
| Pricing, editions and monetisation | `pricing-and-editions` | Only when the price or value of something is itself the subject: what it costs, whether it is worth the money, which edition, pack or DLC to buy and what it includes, sales and discounts, microtransactions and the real-money store. Not a passing mention of buying or owning something, not 'DLC' used as a name, not in-game currency earned by playing, not money idioms, and not when the money talk is only in a (context) message. | 7.3% |
| Bushido final update | `bushido-final-update` | The final content update for Veil of Ages Bushido (the current game): what it adds, rewards, patch notes, platform availability such as Switch; not Domains or Ebontide specifically, which have their own topics. | 6.1% |
| RPG-era games | `rpg-era-games` | Playing the RPG-era titles Sands, Hellas and Fjord: levelling, gear, builds, exploration. | 4.3% |
| Multiplayer and co-op | `multiplayer-and-co-op` | Looking for group, co-op sessions and multiplayer in any Veil of Ages game. | 4.1% |
| Ebontide and new quests | `ebontide-and-new-quests` | The Ebontide quest and other new story quests or missions added to Bushido. | 1.2% |
| Hollow and future titles | `hollow-and-future-titles` | Only conversations that name Veil of Ages: Hollow or speculate about games after it. Not Tides Remastered or any other upcoming release that has its own topic. | 0.8% |
| Other | `other` | None of the other topics fits. | 36.4% |

**Flags** (`ingest/flags.py`, the question Jev answers for each)

| flag | question | share |
|---|---|---|
| excited | Is excitement, hype or enthusiasm about the games, an update, an announcement or an event a main thread of this conversation (more than a passing remark; in a one- or two-message conversation, the message itself)? | 10.2% |
| frustrated | Is frustration or dissatisfaction with the games, an update, or the company or people behind them a main thread of this conversation (more than a passing remark; in a one- or two-message conversation, the message itself)? | 19.4% |
| bug | Does anyone report a defect, crash or performance problem (something broken or behaving wrongly), as opposed to disliking a design choice or finding something hard? | 14.0% |
| feature | Does anyone ask for a change or an addition to a game (a feature request or a concrete suggestion)? | 13.3% |
| help | Is asking the community for help, advice or an explanation a main thread of this conversation? A practical question about playing, fixing or finding something that someone answers counts, even in a longer chat; opinion questions, rhetorical questions and banter do not; in a one- or two-message conversation, the message itself. | 36.3% |
| noise | Is this conversation noise for a community manager: jokes, memes, one-word reactions or off-topic chat with no feedback, question or information about the games? | 35.2% |

**Sentiment** is measured towards "the Veil of Ages games and their developer" (D7), 0 to 1.
