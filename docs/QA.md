# QA

Findings from the QA agents (qa-func, qa-ux) and from him, logged and routed by the main thread.

## Bug log

| id | source | step | observed | expected | severity | owner | status |
|---|---|---|---|---|---|---|---|
| Q1 | qa (W14) | 2: follow-up | In the Domains chat, "which of those are bugs?" answers from the previous turn with no tool call (no steps line), and the check says "Checked: 0 of 3 claims are backed", each "(partly backed)", although the same messages backed the same claims one turn before. | A follow-up re-reads what it cites (or the check accepts messages read earlier in the chat), and the answer shows what the agent did. | P2 | agent | open |
| Q2 | qa (W14) | 2: follow-up | The "0 of 3 backed" line uses the same check-circle icon and "Checked:" styling as "all 9 backed", and adds "Some wording was tightened" although no wording changed. | A failed check looks like a warning, and the tightened line appears only when a rewrite was kept. | P2 | ui | open |
| Q3 | qa (W14) | 2: frustrated, post | The claim check passes a sentence whose cited message backs only part of it. Frustrated: "live-action remakes of childhood shows and ... cheaters in PC crossplay [14]", where msg 14 is only about PC cheaters. Post: "excited about pre-orders, New Game Plus, and new pets [1]", where msg 1 is "pre order done". | Each part of a sentence has its own citation, or the check marks the sentence partly backed. | P2 | agent | open |
| Q4 | qa (W14) | 2: excited, Ebontide | The corroboration reads fail silently. Excited: "(72 conversations could not be read)" of 80. Ebontide: "2 more could not be checked ... (4 conversations could not be read)". Nothing appears in the server log. | Jev failures are logged and retried, and a read that mostly failed is stated plainly in the answer. | P2 | agent | open |
| Q5 | qa (W14) | 1: topic chips | A topic chip lower-cases proper nouns. On prod, "Ebontide and new quests" asks "What are people saying about ebontide and new quests?", and that text is also the chat title and the sidebar entry. The same happens to Tides Remastered, Domains, Bushido and Hollow. `inSentence` in `src/lib/starters.ts` lower-cases every word that is not an acronym. | Proper nouns keep their capitals. | P2 | ui | open |
| Q6 | qa (W14) | 5: long input | There is no length cap on a question. The textarea has no maxlength, and the `/api/chat` Body schema does not limit a part's text, so a pasted question of 100k characters would go to Gemini on the brief's capped key on the public deploy. Found by reading the code; not sent. | A cap in the UI and in the route (for example 2,000 characters), with a one-line message. | P2 | agent | open |
| Q7 | qa (W14) | 1, 3, 2 | The dataset name "Veil of Ages Discord (Levellr sample)" leaks into the UI. The welcome heading reads "What is Veil of Ages Discord (Levellr sample) talking about?": it has no "the", and it swaps in after a skeleton that said "the Veil of Ages Discord". The same name appears in the evidence panel badge and in the out-of-scope answer. | "the Veil of Ages Discord" everywhere. | P3 | data | open |
| Q8 | qa (W14) | 2: post | The "What should we post" chart "Engagement by topic" shows a raw lower-case "other" row. It also ranks "Other games" (158), although D20 leaves other games and chatter out of the ranking. | The chart shows display names only and leaves out other games and chatter, as the answer does. | P3 | ui | open |
| Q9 | qa (W14) | 2: frustrated | The frustrated answer lists talk that is not about Veil of Ages as a player frustration: "live-action remakes of childhood shows" (#off-topic). | Frustrations are about the games and the studio, with chatter left out as D20 does for excitement. | P3 | agent | open |

## Script (optional, only if he asks to click through himself)

| # | do | expect | R3 | R4 |
|---|---|---|---|---|

## Sample inputs
