import type { InferUITools, UIMessage } from "ai";
import type { ScanProgress } from "@/lib/data/scan";
import type { AgentTools } from "./tools";
import type { CorroborationPart } from "./corroborate";
import type { RateCheck } from "./rates";
import type { RevisionPart } from "./revise";
import type { Verification } from "./verify";

// "uncited": an answer from the tools that cites no message, so nothing in it could be checked. Said under it, never
// left blank (QA 2026-09-26, lib/agent/grounding.ts). `read`: whether the turn read any messages at all. `rates`: the
// per-day rates it states that no count gave, left after its one correction (open item 2026-09-26, lib/agent/finish.ts).
export type VerificationPart =
  | { status: "running" }
  | ({ status: "done" } & Verification)
  | { status: "failed"; error: string }
  | { status: "uncited"; read: boolean; rates?: RateCheck[] };

// `stopped`: the reader pressed Stop on this turn, kept with the chat so a reopened one says so (chat/chat-state.ts);
// "checks" when the answer was written and only its claim checks were cut short.
export type ChatMessage = UIMessage<
  { model?: string; startedAt?: number; ms?: number; stopped?: boolean | "checks" },
  { scanProgress: ScanProgress & { toolCallId: string }; verification: VerificationPart; revision: RevisionPart; corroboration: CorroborationPart },
  InferUITools<AgentTools>
>;
