import "server-only";
import { generateText, isStepCount, ToolLoopAgent, type ModelMessage, type UIMessageStreamWriter } from "ai";
import { profile } from "@/lib/data/profile";
import { instructions } from "./instructions";
import { answerModel, chatModel } from "./model";
import { msgTag } from "@/lib/refs";
import { lastQuestion } from "./flags";
import { needsRead } from "./grounding";
import { makeTools } from "./tools";
import { isOffTopic } from "./off-topic";
import { isInScope } from "./scope";

// The one place the agent is put together, so the chat route and the eval run exactly the same thing.
export const MAX_STEPS = 8;

const NO_TOOLS_LEFT =
  "\n\nYou have no tool calls left. Answer now, in plain prose, from what the tools returned. If that is " +
  "not enough, say what you found, what you could not establish, and do not guess.";

type StepLike = { toolResults: ReadonlyArray<{ toolName: string; output: unknown }> };
/** The turn ends at an off-topic reply the tools accepted; an out_of_scope call the scope check turned down (scope.ts)
 *  does not end it, and the model answers from the data. */
export const answeredOffTopic = ({ steps }: { steps: ReadonlyArray<StepLike> }) =>
  steps.at(-1)?.toolResults.some((r) => isOffTopic(r.output)) ?? false;
/** Once turned down, out_of_scope is not offered again this turn, so the model cannot ask the same thing twice. */
export const scopeTurnedDown = (steps: ReadonlyArray<StepLike>) =>
  steps.some((s) => s.toolResults.some((r) => isInScope(r.output)));

export async function makeAgent(writer?: UIMessageStreamWriter) {
  const p = await profile();
  const brief = instructions(p);
  const tools = makeTools(writer, p);
  const toolNames = Object.keys(tools) as (keyof typeof tools)[];
  const model = chatModel();
  const agent = new ToolLoopAgent({
    model,
    instructions: brief,
    tools,
    // An off-topic question ends at the out_of_scope call: its reply is written in code (off-topic.ts), not by the model.
    stopWhen: [isStepCount(MAX_STEPS), answeredOffTopic],
    // The last step may not call a tool. Without this, an agent that keeps searching for something that is not
    // there (a false premise) spends every step on tools and ends with no answer at all - the eval caught it twice.
    // Forbidding tools was not enough: shown a history full of tool calls and no tools, both free models wrote a
    // further tool call as text (F02, in production). So the last step gets no pattern to continue - the history is
    // flattened into one plain brief (question + what each tool returned) - and goes to the fallback model.
    prepareStep: ({ stepNumber, messages, steps }) =>
      stepNumber >= MAX_STEPS - 1
        ? {
            model: answerModel(),
            messages: flattenForAnswer(messages),
            activeTools: [],
            toolChoice: "none" as const,
            instructions: brief + NO_TOOLS_LEFT,
          }
        : // A turn that has only counted may not answer a question about what people say: counts carry no messages,
          // and such an answer quoted threads and a cause with nothing to cite (QA 2026-09-26, grounding.ts). The step
          // must call a reading tool; the step after it answers.
          needsRead(steps, lastQuestion(messages))
          ? { activeTools: ["scan", "find"], toolChoice: "required" as const }
          : scopeTurnedDown(steps)
            ? { activeTools: toolNames.filter((t) => t !== "out_of_scope") }
            : undefined,
    maxRetries: 1,
    temperature: 0.2,
  });
  return { agent, tools, model };
}

/** The answer written from what the tools returned, as the last step writes it, for a turn that ended with no words
 *  (eval run 7, T04: the model wrote its next tool call as text, which is stripped, and the answer was empty). One
 *  call to the answer model; "" when it fails, and the page then says the answer is unfinished. */
export async function answerFromTools(history: ModelMessage[]): Promise<string> {
  try {
    const r = await generateText({
      model: answerModel(),
      system: instructions(await profile()) + NO_TOOLS_LEFT,
      messages: flattenForAnswer(history),
      temperature: 0.2,
      maxRetries: 1,
    });
    return r.text;
  } catch (e) {
    console.warn("answer from tools failed", String(e).slice(0, 200));
    return "";
  }
}

/** The conversation so far as one user message of plain text: what was asked, what was looked up, what came back. */
export function flattenForAnswer(messages: ModelMessage[]): ModelMessage[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const parts = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
    for (const p of parts as Array<{
      type: string;
      text?: string;
      toolName?: string;
      input?: unknown;
      output?: unknown;
    }>) {
      if (p.type === "text" && p.text?.trim()) out.push(m.role === "user" ? `QUESTION: ${p.text}` : p.text);
      else if (p.type === "tool-call") out.push(`LOOKED UP (${p.toolName}): ${JSON.stringify(p.input)}`);
      else if (p.type === "tool-result") {
        const o = p.output as { type?: string; value?: unknown } | undefined;
        out.push(
          `RESULT (${p.toolName}):\n${typeof o?.value === "string" ? o.value : JSON.stringify(o?.value ?? o)}`,
        );
      }
    }
  }
  return [
    {
      role: "user",
      content: out.join("\n\n") + "\n\nWrite the answer to the last QUESTION now, from these results only.",
    },
  ];
}

/** Every message id the agent was shown this turn: a citation to anything else was not read, whatever it says. */
export function retrievedRefs(steps: ReadonlyArray<{ content: ReadonlyArray<unknown> }>): Set<string> {
  const refs = new Set<string>();
  // A message the tools returned is either a message object (it has a numeric ref and a reply_to field - a
  // conversation row has a ref too, and no reply_to) or a [msgN] line inside a transcript.
  const walk = (v: unknown): void => {
    if (typeof v === "string") for (const m of v.matchAll(/\bmsg(\d+)\b/g)) refs.add(msgTag(Number(m[1])));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.ref === "number" && "reply_to" in o) refs.add(msgTag(o.ref));
      Object.values(o).forEach(walk);
    }
  };
  for (const s of steps)
    for (const part of s.content) {
      const p = part as { type: string; output?: unknown };
      if (p.type === "tool-result") walk(p.output);
    }
  return refs;
}
