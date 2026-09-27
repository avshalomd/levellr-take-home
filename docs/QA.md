# QA

Findings from two QA passes, logged during the build and routed to fixes:

- **Bug log (Q1-Q9):** a click-through of the app before delivery by a QA agent. "Step" is the step of its script
  where the finding was seen.
- **Production QA (P1-P18):** an end-to-end pass on the live app just before the tag (P18 was reported from use
  after it and reproduced the same night). Production was frozen at `v1.0`
  after it, so **every P finding is open in `v1.0`**. The ones a reviewer is most likely to meet are in the README's
  known limits, and their fixes are on its roadmap.

Statuses are as of `v1.0` (commit `2ae6130`).

## Bug log

| id | source | step | observed | expected | severity | owner | status at v1.0 |
|---|---|---|---|---|---|---|---|
| Q1 | click-through | 2: follow-up | In the Domains chat, "which of those are bugs?" answers from the previous turn with no tool call (no steps line), and the check says "Checked: 0 of 3 claims are backed", each "(partly backed)", although the same messages backed the same claims one turn before. | A follow-up re-reads what it cites (or the check accepts messages read earlier in the chat), and the answer shows what the agent did. | P2 | agent | **partly fixed in v1.0** (80f5627, D24): a citation backs a claim if any tool in the chat showed it. **Open:** a follow-up that calls no tool still shows no steps line and gets no check (P3). |
| Q2 | click-through | 2: follow-up | The "0 of 3 backed" line uses the same check-circle icon and "Checked:" styling as "all 9 backed", and adds "Some wording was tightened" although no wording changed. | A failed check looks like a warning, and the tightened line appears only when a rewrite was kept. | P2 | ui | **fixed in v1.0** (80f5627, D27): under half backed shows a warning; the tightened line needs a rewrite that changed words. |
| Q3 | click-through | 2: frustrated, post | The claim check passes a sentence whose cited message backs only part of it. Frustrated: "live-action remakes of childhood shows and ... cheaters in PC crossplay [14]", where msg 14 is only about PC cheaters. Post: "excited about pre-orders, New Game Plus, and new pets [1]", where msg 1 is "pre order done". | Each part of a sentence has its own citation, or the check marks the sentence partly backed. | P2 | agent | **fixed in v1.0** (80f5627, D25): a sentence that lists is asked whether one message backs all of it. Production QA found meaning drift that still passes (P9). |
| Q4 | click-through | 2: excited, Ebontide | The corroboration reads fail silently. Excited: "(72 conversations could not be read)" of 80. Ebontide: "2 more could not be checked ... (4 conversations could not be read)". Nothing appears in the server log. | Jev failures are logged and retried, and a read that mostly failed is stated plainly in the answer. | P2 | agent | **fixed in v1.0** (e650633, D28): the reads were all OpenRouter 429s ("High demand for typesafe/jev-1.13 on OpenRouter") under a burst of 20 in flight, with direct TypeSafe out of credit (402) and no other route; a failure is now logged, a 429/5xx/timeout is retried three times with backoff, and 8 read at once. Rerun: 80 of 80 read, 0 failed. Holds in production. **Open:** no special wording for an answer whose reads mostly failed. |
| Q5 | click-through | 1: topic chips | A topic chip lower-cases proper nouns. On prod, "Ebontide and new quests" asks "What are people saying about ebontide and new quests?", and that text is also the chat title and the sidebar entry. The same happens to Tides Remastered, Domains, Bushido and Hollow. `inSentence` in `src/lib/starters.ts` lower-cases every word that is not an acronym. | Proper nouns keep their capitals. | P2 | ui | **fixed in v1.0** (e650633) for the chat page: a topic name keeps its casing; only a leading common word (or, in a Title Case name, every common word) drops its capital (`starters.ts`, tests). Holds in production. **Open** in Explore's prefilled question (P7). |
| Q6 | click-through | 5: long input | There is no length cap on a question. The textarea has no maxlength, and the `/api/chat` Body schema does not limit a part's text, so a pasted question of 100k characters would go to Gemini on the brief's capped key on the public deploy. Found by reading the code; not sent. | A cap in the UI and in the route (for example 2,000 characters), with a one-line message. | P2 | agent | **fixed in v1.0** (e650633, D29): 2,000 characters, `maxLength` on the textarea and a 413 from `/api/chat` with one line the error bar shows (`lib/question-limit.ts`, `error-words.ts`, tests). Holds in production. |
| Q7 | click-through | 1, 3, 2 | The dataset name "Veil of Ages Discord (Levellr sample)" leaks into the UI. The welcome heading reads "What is Veil of Ages Discord (Levellr sample) talking about?": it has no "the", and it swaps in after a skeleton that said "the Veil of Ages Discord". The same name appears in the evidence panel badge and in the out-of-scope answer. | "the Veil of Ages Discord" everywhere. | P3 | data | **fixed in v1.0** (e650633, D30): `lib/community.ts` drops the export's "(Levellr sample)"; the profile (agent, out-of-scope answer) and the welcome heading say "the Veil of Ages Discord", the evidence badge "Veil of Ages Discord". Holds in production. |
| Q8 | click-through | 2: post | The "What should we post" chart "Engagement by topic" shows a raw lower-case "other" row. It also ranks "Other games" (158), although D20 leaves other games and chatter out of the ranking. | The chart shows display names only and leaves out other games and chatter, as the answer does. | P3 | ui | **fixed in v1.0** (e650633, D20) for excitement, resonance and post questions: a by-topic chart leaves out "other" and other games unless asked; an unnamed key reads as words, never raw (`activity-words.ts`, tests). **Open** for frustration charts (P5). |
| Q9 | click-through | 2: frustrated | The frustrated answer lists talk that is not about Veil of Ages as a player frustration: "live-action remakes of childhood shows" (#off-topic). | Frustrations are about the games and the studio, with chatter left out as D20 does for excitement. | P3 | agent | **fixed in the instructions in v1.0** (96f625f, D20): a frustration about films, other games or real life is not a player frustration. **Does not hold** in production (P2). |

## Production QA, 2026-09-27 late

End-to-end QA of https://levellr-take-home.vercel.app in the browser, read-only: 11 questions through the UI plus
three direct `/api/chat` calls to confirm P1 (not saved), desktop and mobile (375 px), dark and light. Production
was redeployed during the run, from `e650633` to `2ae6130` (`v1.0`). The two builds differ only in the app's name
(now "Community Insights", in the page title and the agent's prompt) and in code comments, so every finding applies
to `v1.0`. P1 and P5 were checked again on the new build and still happen. `/api/health` returns
`"commit":"local"`, so which commit is live cannot be read from the app (P16).

**Earlier fixes, checked in production:** Q4 holds (excitement: "checked against the 80 conversations closest ...
of the 83"; frustrations: 80 of 96; no read failed). Q5 holds for the topic chips on the chat page ("What are
people saying about Ebontide and new quests?", the same in the title and the sidebar), but not in Explore (P7). Q6
holds: the textarea has `maxlength=2000`, and a 2,520-character question sent past it gets a 413 and "That question
is 2,519 characters long. Keep it under 2,000 and ask again." Q7 holds: the welcome heading, the out-of-scope
answer and the evidence badge all use the right name. Q8 was not exercised: neither the excitement answer nor the
post answer drew a by-topic chart. The frustrations chart still shows the same raw row (P5). Q9 does not hold (P2).

**Latency** (from pressing send to the end of the answer): excited 11 s, frustrations 27 s, follow-up 4 s, post
11 s, Ebontide chip 11 s, Domains 24 s, counts 3 s and 3 s, false premise 6 s, off-topic 1 s.

**Worked:** citation chips open the evidence panel with the cited message lit and numbered in its thread tree,
on desktop and as a bottom sheet on mobile. The "what the agent did" line opens its steps. Figures carry a source
marker (mood 37/100, 52/100). No tool text, raw keys or JSON showed up in any answer. Reloading a saved chat brings
back its answer, chips and check. The sidebar lists every chat, "New chat" works, and an unknown `/c/<id>` shows
"This chat is not here". The out-of-scope answer declines and suggests three questions. The false premise ("Why
are people so angry that Tides Remastered was cancelled?") is corrected: "The conversations do not show that Tides
Remastered was cancelled." Explore draws its grid: the week totals 28 + 1,261 + 1,073 = 2,362 match the dataset,
Days has 15 columns, and a selected cell opens the panel (Domains 21-27 Sep: 90 conversations, 82 people, 8% of
1,073). Mobile has no horizontal scroll on / or /explore, and light and dark both render. No console errors came
from the app itself: every console error came from the QA's own probes (413s, a 400, a 404 on a made-up id, a
synthetic keydown).

| id | what was done | what happened | expected | severity | status |
|---|---|---|---|---|---|
| P1 | /explore, Tides Remastered 14-20 Sep (and Domains 21-27 Sep), Details, then clicked a "Busiest conversations" row. | It opens a chat asking "What did people say in conv1268 in #remaster-discussion?", and the answer is empty: "Answered in under a second", "This answer was not finished", and "Ask again" fails the same way. It happened on two conversations (conv1807, conv1268) and again through a direct POST on the new build: the stream is `start-step`, `finish-step`, `finish` with no text and no tool call. The internal handle `conv1268` also shows in the question, the chat title and the sidebar. The prompt comes from `SelectionPanel.tsx:292`, and the instructions tell the model never to write handles. An empty first step ends without a text answer, so the forced last step (DESIGN.md, loop control) does not run. | The row opens that conversation in the evidence panel, or asks a question the agent can answer, with no handle in visible text. An empty model turn falls through to the forced answer, or to an error that names the cause. | major | open |
| P2 | "What are the top frustrations players have right now?" | Its "Pricing, editions and monetisation" section is built from #off-topic talk about GTA 6: "games are becoming 'very expensive' with standard editions costing $80 and ultimate editions $100 [19][20]" (msg 19: "Gta 6 has been revealed by Rockstar to cost 80 dollars for standard edition and 99 dollars for ultimate"), and "physical releases being only a code in a box, with no disc [21][22][23]" (the same GTA thread). The check passed all 18 claims. A manager would read this as a complaint about Veil of Ages pricing. | Q9 / D20: frustrations with other games are not player frustrations. The pricing section cites Veil of Ages talk only (msg 17, shops behind the Ultimate edition, may qualify), or says that pricing talk this week was mostly about GTA 6. | major | open |
| P3 | In the same chat: "Which of those are bugs?" | After 4 s: "None of the frustrations listed are bugs. They are related to design choices, story elements, game balance, or pricing ...". There was no tool call, no steps line, no citations and no check. The data has a `bug` flag (14% of conversations), and other answers found bugs in this same window: "soft locks during the Ebontide quest", "Garrett Pike ... dying in one hit", "stuck in walls, bosses refusing to die". | A follow-up that asks for a slice runs a tool (frustrated plus bug, or a search), answers with citations, and shows its steps and check. This is Q1 again: the fix in 80f5627 only helps when the answer cites. | major | open |
| P4 | Starter "What should we post about this week?" | Three suggestions, each resting on one message (sleeper stars, general Tides hype, outfits), and none backed by any other conversation. The footer still says "The number beside a claim is how many more of them say it". The only step is an excitement scan. It used no engagement or resonance measure (D5) and drew no chart, so nothing says which subjects drew the most replies and reactions. | Rank candidates by what resonates (authors + replies + reactions) as well as by excitement, give counts from code, and ground each suggestion in more than one conversation, or say that the evidence is thin. | major | open |
| P5 | Same frustrations answer: its chart "Conversations by topic, in frustrated conversations". | The top row is a raw lower-case "other" (66), and "Other games" (32) is also ranked. Q8's filter only applies when the question matches `/excit\|resonat\|hype\|looking forward\|post\|posting\|engag/` (`activity-words.ts:282`), and "frustrat" is not in that list. The `keyWords` fallback never runs either: the taxonomy names the topic "other" (`/api/overview` topics: `{"key":"other","name":"other"}`), so `topicNames.get("other")` returns the lower-case name. Seen again after the redeploy. | D20 covers frustration charts too. A display name is never lower-case "other". | minor | open |
| P6 | "What are people most excited about this week?" | The last bullet is about other games: "some members are also excited about other upcoming games like Xenoverse 3 ... and GTA 6 [8][9] +3 more". | D20: other games are left out of excitement answers unless the question asks for them. | minor | open |
| P7 | Explore: selecting a cell prefills the chat question. | "What were people saying about domains in the week of 21 September 2026?" and "... about tides remastered in the week of 14 September 2026?". Explore builds its question in `insights-question.ts:35` (`lower`), which Q5's fix in `starters.ts` did not touch. | Proper nouns keep their capitals, as the chat page's topic chips now do. | minor | open |
| P8 | False premise about Tides Remastered. | The answer says Tides Remastered has an "upcoming launch on July 9, 2026", but "now" is 27 Sep 2026. The cited messages say "launches on July 9" (dated 18 Sep) and "Today is 25th of June and we going to have Remastered in 9th of July" (dated 27 Sep). The dates inside messages disagree with the export's timestamps, which suggests the export was time-shifted. docs/DATA.md did not record this; it now does (Profile). | The data profile records that dates in message text do not match the timestamps. The agent quotes such dates as written ("players cite a 9 July launch") and does not add a year that makes them contradict "now". | minor | open |
| P9 | The Domains question and the frustrations answer, with the cited messages checked. | Several paraphrases passed the check with their meaning shifted. "The main complaints ... It isn't challenging or hard" [1]: the message means the mode is not a fair challenge, only random deaths, and the sentence reads as "too easy". "Some suggest that certain weapons (the spear and sword) should be for doing levels 6 or 7" [16] is garbled; the message means those rewards should unlock at challenge 6 or 7. "promoting 'BF' (Bushido Final update)": the gloss is invented, since BF names another game elsewhere in the data ("like BF"). | The claim check (or the rewrite) catches a sentence whose meaning differs from its message, and does not add expansions the message lacks. This is Q3 in another form. | minor | open |
| P10 | "How many conversations were about pricing last month?" | "The conversations cover from 13 Sep 2026 to 27 Sep 2026, so there are no conversations about pricing from last month in this dataset." The follow-up for the last 7 days against the week before was right: 104 against 69, which adds up to the 173 on the welcome chips, "+51%". | The answer says August is outside the data, so it cannot count it (not that there were none), and offers the in-window count (173). | minor | open |
| P11 | The 2,520-character question from Q6. | The error bar's "Try again" resends the same question, which gets a 413 again. The textarea has been emptied, so the text is lost apart from the bubble. The client also asks for `/api/chats/<id>` after each 413 and gets 404 twice. | For a 413, put the text back in the box to edit, not "Try again"; do not fetch a chat that was never saved. | minor | open |
| P12 | The frustrations answer, read as a whole. | The same item shows up in two sections: no parkour in Tides Remastered under Series Direction and again under Tides Remastered, and the cut modern-day segment under Series Direction and again under Lore and Story. The section headings are Title Case ("Series Direction"), while the topic names are sentence case. The header "(42 of 44 frustrated conversations about this topic)" does not say what the 42 are. | Each point appears once, headings use the topic names, and the header says what it counts. | polish | open |
| P13 | Post answer footer. | "The number beside a claim is how many more of them say it" appears when no claim has a number beside it. | The sentence appears only when a number is shown, or the footer says that no other conversation repeats these claims. | polish | open |
| P14 | Excitement answer, chip 9. | The panel's tab and heading read "#off-topic: I can't believe we're only a couple weeks out from Tides Remastered" (the conversation's first line), while the lit message is "I've been waiting for it since I finished GTA 5 back in 2014". It reads as if the claim cites a Tides message. | The heading, or at least the tab, names the cited message; or it is labelled as the conversation's opening. | polish | open |
| P15 | Explore details. | The busiest "conversations" say "116 messages" and "195 messages", but a conversation holds at most 40. These are sessions. The colour scale tops out at 439, set by the "Other" row, so topic rows look pale. The first week column is labelled "7" but holds only 13 Sep. "Multiplayer and co-op" wraps as "co- / op" on mobile. | Label the counts as the session; scale colours without the residual row, or state which row sets the scale; label a partial week with the days it holds. | polish | open |
| P16 | `/api/health`. | Returns `"commit":"local"` for a CLI deploy, and production was redeployed partway through this QA with no way to tell which commit went out. | Health reports the git SHA (inject it at deploy time), so a QA run can say what it tested. | polish | open |
| P17 | Wording. | "rose by +51%" (double sign). The steps line "Read the same 210 conversations twice, for two questions and searched once" is hard to parse. | "rose 51%"; "Read 210 conversations for two questions, and searched once". | polish | open |
| P18 | One long chat of nine questions: scans, follow-ups ("which of those are bugs?", "tell me more about the second one"), an out-of-scope question and a count. The 7th was "What are people saying about Tides Remastered?". | The 7th question fails after 3 s: the error bar reads "The model could not answer: Please ensure that function call turn comes immediately after a user turn or after a function response turn." and leaves an empty answer in the chat. "Try again" fails the same way. The 8th question worked and the 9th failed again. The input stays enabled throughout, so the chat looks usable but stops answering. Root cause in the route (`src/app/api/chat/route.ts:86`): see below. | Every question in a chat gets an answer, however long the chat. | major | open |

**P18, the long chat that stops answering.** Reported from production use after the pass: partway through a long
chat, no further question got an answer. The production logs show the same Gemini error three times in that chat
(23:23 to 23:29 Oslo time) before it was deleted. Reproduced in the browser on `v1.0` in a new chat, one question
at a time, with the request each question sent:

| question | time | request | result |
|---|---|---|---|
| 1. What are people saying about the Domains? | 14 s | 1 message, 0.2 KB | answered (scan) |
| 2. which of those are bugs? | 8 s | 3, 214 KB | answered (no tool) |
| 3. what's the revenue? | 4 s | 5, 219 KB | answered (out of scope) |
| 4. What are people excited about? | 13 s | 7, 221 KB | answered (scan) |
| 5. How many conversations mention crashes? | 27 s | 9, 348 KB | answered (scan) |
| 6. tell me more about the second one | 8 s | 11, 495 KB | answered (read_conversation) |
| 7. What are people saying about Tides Remastered? | 3 s | 13, 517 KB | **error**; "Try again": 13, 517 KB, **error** |
| 8. What are people frustrated about? | 20 s | 15, 518 KB | answered (scan) |
| 9. which of those are bugs? | 3 s | 17, 754 KB | **error** |

No console errors. Every response was HTTP 200 carrying an error part in its stream. Three direct POSTs to
`/api/chat` isolate the cause: a 13-message chat whose 2nd message (the first answer) starts with a tool call fails
with the same error; the same chat cut to 11 messages answers; a 13-message chat whose 2nd message is a plain-text
answer also answers.

*Root cause.* The route sends the model only the last 12 UI messages: `convertToModelMessages(messages.slice(-12),
...)` (`src/app/api/chat/route.ts:86`). A request always ends with the new question, so from the 7th question on it
holds an odd number of messages (13, 15, ...), and the 12-message window starts on an **assistant** message: the
answer given six questions earlier. When that answer began with a tool call (almost every answer from the data: a
scan, a search, a count, an out-of-scope reply), the model input opens with a function-call turn that follows no
user turn, and Gemini refuses the whole request. Converting the same history locally shows it: 11 messages start
`user`, 13 start `assistant[tool-call]`. So which questions fail depends only on the answer six questions back: in
the run above, question 8 worked because the answer at the cut (question 2's) had no tool call, and question 9
failed on question 3's out-of-scope call. "Try again" resends the same history and fails the same way, and every
failure adds an empty answer to the chat and saves it (question 7's and 9's are empty in the saved chat). The error
bar shows the provider's own words, which tell the reader nothing they can do.

*Ruled out.* Request size: the largest request was 754 KB, far under Vercel's 4.5 MB limit. The route's 200-message
cap is 100 questions away. The 2,000-character cap applies only to the new question (`route.ts:55`). The input is
never disabled (the Composer has no `disabled` on the textarea). Quota: the error comes back in 2 to 3 s from a
request Gemini rejected for its shape. Request size is still a slower risk: each answer with a scan carries its tool
results back in every later request (130 to 530 KB each in the saved chats), so a chat of 10 to 30 such answers
would reach the 4.5 MB limit and get a 413 from the platform.

*Fix* (not applied; production is frozen): start the window at a user message, e.g. take the last 12 messages and
drop any leading assistant messages before `convertToModelMessages`, with a test that a 13-message chat converts to
input whose first message is the user's. Better, and it also removes the size risk: send only the new question and
the chat id, and read the history from the saved chat on the server. Also drop an empty failed answer from the
history, and show a plain line for a provider error instead of its text.

## v1.1 release candidate QA

End-to-end QA of branch `release-v1.1` at `f5767a1`, on localhost (`next dev`, port 3070) against the production
Neon database and the brief's Gemini key, 2026-09-28. The run asked 17 questions that called the model, in three
chats: one long chat of 12 turns, a second chat of 4, and a fresh chat. It also made two requests that never reached
the model: a stubbed error stream, to exercise the retry buttons, and a question over 2,000 characters. The run
covered Explore, desktop (1280 px) and mobile (375 px) widths, and dark and light mode. Nothing was relabelled or
deleted.

**Verdict: BLOCKED, one item (B1).** Every P finding that was exercised is fixed or mostly fixed. B1 is a new
failure: a follow-up states a wrong count and marks it as counted by code.

**Test setup.** Turbopack refused to start: the checkout's `node_modules` is a symlink that points outside the
project root. The run used `next dev --webpack` instead. On the first visit to `/c/[id]`, webpack compiled the route
and reloaded the page, which aborted the stream of question 3. The page recovered on its own: it showed "Still
writing this answer" and then the saved answer. This comes from the dev server, not the app. `next dev` also wrote an
untracked `AGENTS.md`, which was removed afterwards.

### The fixes, checked

| id | status | evidence |
|---|---|---|
| P18 | **fixed** | One chat of 12 questions, every one answered: frustrated, a bugs follow-up, excited, post, Domains, "tell me more about the second one", Tides Remastered (7th, where v1.0 failed), pricing last month, weather, false premise, Ebontide, and a second bugs follow-up. No "function call turn" error, no provider text. The reloaded chat holds all 12 answers with their checks, and none is empty. To exercise the retry path, an error stream was stubbed in the page (`The model could not answer this turn. Try again, or start a new chat.`): "Try again" was offered once, and after the same failure "New chat" replaced it. "New chat" opened a clean page with the input focused. Remaining risk: the client still sends the whole chat with each question. The 12-turn chat is 1,264 KB saved, so Vercel's 4.5 MB request limit is about 40 such turns away. That case now offers a new chat, by code; it was not exercised. |
| P1 | **fixed** | Explore > Domains 21-27 Sep > Details > the top "Busiest sessions" row opens the session in the reply tree ("Conversation 1 of 4 in this session"), with the conversation handle nowhere in the page. Next showed 2 of 4 and previous went back to 1 of 4. Esc closed it. |
| P2 | **fixed** | "What are the top frustrations players have right now?": no pricing section and no GTA 6. Every section is about the community's own games. The last-few-days frustrations answer had no other games either. |
| P6 | **fixed** | "What are people most excited about this week?" ends its lead with "(Conversations about other games were left out.)". No Xenoverse or GTA 6. |
| P3 | **fixed** | "Which of those are bugs?" after the frustrations answer ran a tool ("Read 56 bug reports (51 bore on the question)", 1 step), cited 12 messages and checked them: "all 9 claims are backed". The same follow-up after Ebontide ran a search, and all 4 claims were backed. Note: the first run read every bug report since 24 Sep, not only the frustrations listed before it. |
| P4 | **partly fixed** | The post answer counts engagement by topic in code, draws the "Engagement by topic, from 20 Sep" chart (without "Other games" or "other") and gives four ideas. Two of the ideas rest on one message each: the sleeper stars (1) and the Hana build ("One player shared ..."). The Veil of Ages 3 lore idea cites two messages from one conversation. None of them is marked as thin in its own text. Only the footer says it: "No other conversation among them repeats any claim." Each idea quotes a topic's engagement score beside a single item (for example, the sleeper stars idea cites "261", which is the score of the whole Bushido topic). |
| P5 | **not exercised** | Neither frustrations answer drew a by-topic chart. The post chart had no raw "other" row. The post answer's text says `The "Other games" and "other" topics were left out`, so the raw key still shows in the words (N6). |
| P7 | **fixed** | The prefilled question reads "What were people saying about Domains in the week of 21 September 2026?" |
| P8 | **not exercised as such** | No answer gave a date from a message. The false-premise answer says "players are discussing its upcoming release, preloading", which is "upcoming" relative to the messages. It adds no date or year. |
| P9 | **still seen** | In the post answer, "pre-ordering and expressing excitement for new game plus, new pets" cites "pre order done 😍". New game plus and new pets are in the next message of the same session ("🔥 new game plus/new pets"), which is not cited. The check passed it, because the session backs the claim even though the cited message does not. |
| P10 | **fixed** | "How many conversations were about pricing last month?" answers: "The conversations do not cover last month. From 13 Sep to 27 Sep, there were 173 conversations about Pricing, editions and monetisation." |
| P11 | **mostly fixed** | A question of 2,184 characters (sent with `maxlength` removed) returned a 413. The page showed "That question is 2,183 characters long. Keep it under 2,000 and ask again." The text went back into the box, the bubble was removed, there was no "Try again", and no chat was saved. **Still open:** the page asked for `/api/chats/<id>` twice after the 413 and got 404 twice (server log and console). |
| P12 | **fixed in this run** | The top-frustrations answer lists each point once, and its headings are in sentence case ("Domains difficulty and bugs"). It has no unexplained "(42 of 44 ...)" header. |
| P13 | **fixed** | The post footer reads "No other conversation among them repeats any claim." Where claims do have numbers, it reads "The number beside a claim is how many more of them say it". |
| P14 | **fixed** | The panel's tab names the cited message ("Are any of the Devs on here?...", "I am most excited to seeing h..."). The heading reads "Opens with ..." for the conversation's first line. |
| P15 | **partly fixed** | The rows say "24 Sep, 116 messages in 4 conversations" and "Busiest sessions". A partial week is explained ("A dashed date is a week at the start or end of the data") and "7" is dashed. **Still open:** the colour scale tops out at 439, set by the "Other" row. |
| P16 | **fixed (locally)** | `/api/health` returns `{"ok":true,"database":"up","ai":{"provider":"google"},"commit":"local"}`. A deploy would fill the commit from `APP_COMMIT` or `VERCEL_GIT_COMMIT_SHA`, which was not checked here. |
| P17 | **fixed** | "... last 7 days compared with the week before?" answers "104 ... compared to 69 ... a 51% increase", with no "+". The steps line reads "Counted conversations twice", and a chart compares the two periods. |

### New issues, by severity

| id | severity | what happened | expected |
|---|---|---|---|
| B1 | **blocker** | In the long chat, "tell me more about the second one" (after the Domains answer, whose second point is bugs) answered with no tool call and no steps line: "Among the 56 bug reports about the Domains from 13 Sep 2026 to 27 Sep 2026, ... the average mood in these conversations being 47/100", and the mood carried the counted-figure marker. Both numbers belong to the earlier answer, "Read 56 bug reports", which covered **all topics from 24 Sep**. A read-only count on the database gives **114** Domains conversations flagged as bugs (`p_bug >= 0.5`) from 13 to 27 Sep. Under the answer, the check line reads "Checked: 4 of 5 claims are backed". The saved text carries `47/100 [scan]`. `sourcelessFigures` (`src/lib/agent/rates.ts:118`) accepts a tag when a tool of that name ran anywhere in the chat, and `countMismatches` checks rates only, so a count restated for a different slice goes through. A second follow-up of the same kind ("tell me more about the first one") stated no number, so the failure happens only some of the time. | A count or mood in a follow-up comes from a tool result for the same slice and period, or the answer states none. A figure tag is accepted only when a tool result in this chat holds that number for that slice; otherwise the tag is dropped or flagged as sourceless. |
| N1 | major | Off-topic questions in the middle of a chat skip the out-of-scope path. After 3 questions, "Can you write me a poem about pirates?" got a 12-line pirate poem in 2 s, with no tool call and no check. In the long chat, "What's the weather going to be in Oslo tomorrow?" was declined in the model's own words, with none of the three suggested questions. In a fresh chat, the same poem request gets the proper out-of-scope answer: "I can't answer that. I only know what the Veil of Ages Discord talked about from 13 Sep to 27 Sep 2026. You could ask:" and three suggestion buttons. | Any turn that calls no tool and cites nothing is checked for scope (the Jev `bearsOn` check already exists), or the instructions make `out_of_scope` the only way to decline, whatever the history. |
| N2 | minor | The false-premise answer ("Why are people so angry that Tides Remastered was cancelled?") corrects the premise and then repeats most of the previous Tides Remastered answer, including "173 of 236 conversations ... 55/100". Its footer says "all 8 conversations that bore on the question". | The correction and what the search found, without re-running the previous answer. |
| N3 | minor | Some follow-ups answer from earlier results and call no tool ("tell me more about the first one", "tell me more about the second one"). They have no steps line, although they cite and are checked. | Acceptable when the answer adds no number (see B1). |
| N4 | minor | The client still sends the whole chat with each question: 1,264 KB after 12 turns (P18's size risk). | Send the new question and the chat id, and read the history on the server (P18's longer-term fix). |
| N5 | polish | P11 still fetches `/api/chats/<id>` twice after a 413 (404 twice in the console). | Fetch nothing for a chat that was never saved. |
| N6 | polish | The post answer's text says `"other" topics were left out` (the raw key, lower case). | "Other games and uncategorised talk were left out". |

### Regression pass

- **Core questions:** excited this week (97 read, 76 bore on it, 7 of 7 backed), frustrated in the last few days
  (89 read, 8 of 8 backed), Domains (223 read, 8 of 9 backed), Ebontide (search, 6 of 7 backed), a count (pricing,
  last month and week over week), a false premise ("The conversations do not indicate that Tides Remastered was
  cancelled"), off-topic (fresh chat right; mid-chat wrong, N1). No tool text, raw JSON or keys in any answer.
- **Evidence panel:** citation chips open it with the cited message lit and numbered in the thread tree, on desktop
  and as a bottom sheet at 375 px. "Show the whole session" works.
- **Steps line:** "2 steps" opened to "Counted engagement ..." and "Read 97 excited conversations ...", with the chart.
- **Saved chats:** reloading `/c/<id>` brings back all 12 answers with their checks. The sidebar lists the new chats
  under "Today". New chat works from the sidebar and from the error bar.
- **Mobile (375 px):** no horizontal scroll on the chat page or on /explore. The menu opens the chat list.
- **Dark and light:** both render; the theme toggle works (left on dark).
- **Console:** the only errors were the QA's own 413, and the two 404s from N5. The dev server logged one
  `__webpack_require__.C is not a function` for `/api/thread/[id]` static paths (webpack dev only; the request
  returned 200).

**Latency**, from pressing send to the end of the answer, as the answer footers report it: frustrated in the last
few days 13 s, bugs follow-up 10 s, excited 11 s, post 9 s, Domains 14 s, "second one" 5 s, Tides Remastered 14 s,
pricing last month 3 s, weather 1 s, false premise 10 s, Ebontide 10 s, bugs follow-up (Ebontide) 6 s, top
frustrations 26 s, "first one" 4 s, week-over-week count 4 s, poem mid-chat 2 s, poem in a fresh chat 2 s.
