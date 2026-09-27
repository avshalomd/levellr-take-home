# Levellr — Technical Exercise

Thanks for taking the time. This is about how you **think, scope, and ship under time pressure** — not a complete or perfect solution.

## How it works
- **Time:** ~90 minutes, async — block the time, and send us your **repo URL** when you're done.
- **Setup:** your own repo + preferred libraries. **TypeScript is required**; the frontend stack is your choice.
- **AI tools:** fully allowed and encouraged — we work this way every day.
- **Scope:** the brief is intentionally broad — **you won't finish it.** Prioritise to a small, demoable slice and note your assumptions + trade-offs.
- **During:** work independently. The key works as of send time; if you get **auth errors**, email us; **quota/limit errors** mean you've hit the (generous) spend cap — note it and move on.
- **After:** a ~1-hour follow-up call to walk through your decisions and a few "what if" scenarios.

## What we provide
- `messages.json` — **~25.5k anonymised messages** from one gaming community's Discord (**the last ~2 weeks**; pseudonymous handles) — so relative-date questions like "last 3 days" work. Each looks like:

```json
{
  "id": "msg_000054",
  "community_id": "comm_1",
  "channel": "rpg-chat",
  "author": { "id": "user_0003", "name": "HiddenFox" },
  "timestamp": "2026-06-22T11:00:24.403Z",
  "text": "But if u feel weak take a break and upgrade ur stuff",
  "reactions": [ { "emoji": "👍", "count": 1 } ],
  "reply_to": "msg_000003"
}
```

`author` is `{id, name}`, `reactions` is an array (often empty), and `reply_to` is another message's id or `null`.

- A **temporary, credit-capped LLM API key** (model id + a short SDK snippet, sent separately).

## Your brief
You're building for a **Community & Marketing Manager** at a game studio. They want a pulse on what the community is *excited about* — themes, sentiment around recent updates/events, what's resonating — to shape content and comms. **Build a chatbot they can ask questions about the community's messages.**

Example questions your user might ask:
- *"What have players been frustrated about in the last few days?"*
- *"What are people most excited about right now?"*
- *"What should we post about this week?"*

Build something that can start to answer questions like these — you decide what to prioritise and what to leave out.

A simple Q&A (ask a question, get a useful answer grounded in the messages) is plenty. Anything beyond — filtering, better retrieval, follow-ups — is a **bonus, not expected**. We care far more about your **choices and reasoning** than how much you cover: get something working, then tell us (in the README or on the call) what you assumed, what you cut, and what you'd do next.
