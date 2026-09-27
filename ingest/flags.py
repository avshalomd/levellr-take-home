"""The yes/no flags every conversation is labelled with, besides its topics and sentiment (DESIGN.md decision 4).

They answer the brief's questions directly (what excites people, what frustrates them) and the kinds of message a
community team triages (bugs, requests, help, noise). The suggestion step names them so it does not rebuild them as
topics; the labelling step asks each as its own question and stores the probability as p_<name>.
"""

from __future__ import annotations

FLAGS: dict[str, str] = {
    "excited": "Is excitement, hype or enthusiasm about the games, an update, an announcement or an event a main "
    "thread of this conversation (more than a passing remark; in a one- or two-message conversation, the message "
    "itself)?",
    "frustrated": "Is frustration or dissatisfaction with the games, an update, or the company or people behind them "
    "a main thread of this conversation (more than a passing remark; in a one- or two-message conversation, the "
    "message itself)?",
    "bug": "Does anyone report a defect, crash or performance problem (something broken or behaving wrongly), as "
    "opposed to disliking a design choice or finding something hard?",
    "feature": "Does anyone ask for a change or an addition to a game (a feature request or a concrete suggestion)?",
    "help": "Is asking the community for help, advice or an explanation a main thread of this conversation? A "
    "practical question about playing, fixing or finding something that someone answers counts, even in a longer "
    "chat; opinion questions, rhetorical questions and banter do not; in a one- or two-message conversation, the "
    "message itself.",
    "noise": "Is this conversation noise for a community manager: jokes, memes, one-word reactions or off-topic chat "
    "with no feedback, question or information about the games?",
}
