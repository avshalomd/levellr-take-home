"""The yes/no flags every conversation is labelled with, besides its topics and sentiment (DESIGN.md decision 4).

They answer the brief's questions directly (what excites people, what frustrates them) and the kinds of message a
community team triages (bugs, requests, help, noise). The suggestion step names them so it does not rebuild them as
topics; the labelling step asks each as its own question and stores the probability as p_<name>.
"""

from __future__ import annotations

FLAGS: dict[str, str] = {
    "excited": "Does anyone in the conversation express excitement, hype or enthusiasm about the games, an update, "
    "an announcement or an event?",
    "frustrated": "Does anyone express frustration or dissatisfaction with the games, an update, or the company or "
    "people behind them?",
    "bug": "Does anyone report a defect (something broken, crashing or behaving wrongly), as opposed to disliking a "
    "design choice?",
    "feature": "Does anyone ask for a change or an addition to a game (a feature request or a concrete suggestion)?",
    "help": "Does anyone ask the community for help, advice or an explanation?",
    "noise": "Is this conversation noise for a community manager: jokes, memes, one-word reactions or off-topic chat "
    "with no feedback, question or information about the games?",
}
