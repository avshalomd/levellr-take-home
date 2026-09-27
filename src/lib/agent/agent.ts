import "server-only";
import {
  generateText,
  isStepCount,
  ToolLoopAgent,
  wrapLanguageModel,
  type LanguageModel,
  type LanguageModelMiddleware,
  type ModelMessage,
  type UIMessageStreamWriter,
} from "ai";
import { profile } from "@/lib/data/profile";
import { topicLabels } from "@/lib/data/read";
import { instructions } from "./instructions";
import { answerModel, chatModel } from "./model";
import { msgTag } from "@/lib/refs";
import { asksForSlice, isRefusal, lastQuestion } from "./flags";
import { asksWhatPeopleSay, needsRead } from "./grounding";
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

/** Whether the turn is a follow-up in a chat: an earlier answer is in the messages. */
const followsUp = (messages: ReadonlyArray<ModelMessage>) => messages.some((m) => m.role === "assistant");

// Production QA 2026-09-27 (P1): a question opened from Explore came back as start-step, finish-step, finish, with no
// text and no tool call; the loop ends on a step without a tool call, so the forced last step never ran and the page
// said "This answer was not finished". Reproduced on Gemini 2.5 Flash: two of three runs of the same question were
// empty. A step that comes back with nothing (no words, no tool call) is asked again once, made to call a tool when it
// was offered tools and free to choose, so the loop goes on to read and then answer. A second empty step is left
// as it is: the answer is then written from what the tools returned (finish.ts, answerFromTools).
type CallOptions = Parameters<NonNullable<LanguageModelMiddleware["wrapStream"]>>[0]["params"];
type Streamed = Awaited<
  ReturnType<Parameters<NonNullable<LanguageModelMiddleware["wrapStream"]>>[0]["doStream"]>
>;
type StreamPart = Streamed["stream"] extends ReadableStream<infer P> ? P : never;
type Content = Awaited<
  ReturnType<Parameters<NonNullable<LanguageModelMiddleware["wrapGenerate"]>>[0]["doGenerate"]>
>["content"][number];

/** A part that is something the reader or the loop can use: words, a tool call, a file, or an error to report. */
export function isContent(p: StreamPart | Content): boolean {
  if (p.type === "text-delta") return p.delta.trim() !== "";
  if (p.type === "text") return p.text.trim() !== "";
  return p.type === "tool-call" || p.type === "tool-input-start" || p.type === "file" || p.type === "error";
}

const forceTool = (params: CallOptions): CallOptions =>
  params.tools?.length && (!params.toolChoice || params.toolChoice.type === "auto")
    ? { ...params, toolChoice: { type: "required" } }
    : params;

export const retryEmpty: LanguageModelMiddleware = {
  wrapGenerate: async ({ doGenerate, params, model }) => {
    const first = await doGenerate();
    if (first.content.some(isContent)) return first;
    console.warn("empty model step, asked again", {
      model: model.modelId,
      toolChoice: params.toolChoice?.type,
    });
    return model.doGenerate(forceTool(params));
  },
  // Streamed, the parts are held until the first one with content: a step with content passes through unchanged,
  // held parts first; one that finishes with none is asked again, and the reader never sees the empty one.
  wrapStream: async ({ doStream, params, model }) => {
    const first = await doStream();
    const reader = first.stream.getReader();
    const held: StreamPart[] = [];
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      held.push(r.value);
      if (!isContent(r.value)) continue;
      const stream = new ReadableStream<StreamPart>({
        start: (c) => held.forEach((part) => c.enqueue(part)),
        pull: async (c) => {
          const next = await reader.read();
          if (next.done) c.close();
          else c.enqueue(next.value);
        },
        cancel: (why) => reader.cancel(why),
      });
      return { ...first, stream };
    }
    console.warn("empty model step, asked again", {
      model: model.modelId,
      toolChoice: params.toolChoice?.type,
    });
    return model.doStream(forceTool(params));
  },
};

// Eval 2026-09-28 (P02): made to call a tool, Gemini 2.5 Flash wrote 1,085 aggregate calls in one turn, 540 of each of
// two identical ones, and the turn took four minutes. A step keeps each distinct call once, only calls to a tool it
// was offered, and at most MAX_CALLS of them; the rest are dropped before anything runs. Streamed, a call's input parts
// are held until the call itself arrives, so a dropped call leaves no half-drawn step on the page.
export const MAX_CALLS = 6;
function callFilter(params: CallOptions) {
  const offered = new Set((params.tools ?? []).map((t) => t.name));
  const seen = new Set<string>();
  return (p: { toolName: string; input: string }) => {
    const key = `${p.toolName} ${p.input}`;
    if (seen.has(key) || seen.size >= MAX_CALLS || (offered.size && !offered.has(p.toolName))) return false;
    seen.add(key);
    return true;
  };
}
export const oneCallEach: LanguageModelMiddleware = {
  wrapGenerate: async ({ doGenerate, params }) => {
    const r = await doGenerate();
    const keep = callFilter(params);
    const content = r.content.filter((p) => p.type !== "tool-call" || keep(p));
    if (content.length < r.content.length)
      console.warn("tool calls dropped", {
        kept: content.filter((p) => p.type === "tool-call").length,
        of: r.content.filter((p) => p.type === "tool-call").length,
      });
    return { ...r, content };
  },
  wrapStream: async ({ doStream, params }) => {
    const r = await doStream();
    const keep = callFilter(params);
    const held = new Map<string, StreamPart[]>();
    let dropped = 0;
    const stream = r.stream.pipeThrough(
      new TransformStream<StreamPart, StreamPart>({
        transform: (part, c) => {
          if (
            part.type === "tool-input-start" ||
            part.type === "tool-input-delta" ||
            part.type === "tool-input-end"
          ) {
            held.set(part.id, [...(held.get(part.id) ?? []), part]);
            return;
          }
          if (part.type === "tool-call") {
            const input = held.get(part.toolCallId) ?? [];
            held.delete(part.toolCallId);
            if (!keep(part)) {
              dropped++;
              return;
            }
            input.forEach((x) => c.enqueue(x));
          }
          if (part.type === "finish") {
            held.forEach((parts) => parts.forEach((x) => c.enqueue(x)));
            held.clear();
            if (dropped) console.warn("tool calls dropped", { dropped });
          }
          c.enqueue(part);
        },
      }),
    );
    return { ...r, stream };
  },
};

/** A model whose steps keep each tool call once (oneCallEach) and whose empty steps are asked again (retryEmpty). A
 *  gateway model named by a string is left as it is. */
export const steady = (model: LanguageModel): LanguageModel =>
  typeof model === "string"
    ? model
    : wrapLanguageModel({
        model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
        middleware: [retryEmpty, oneCallEach],
      });

export async function makeAgent(writer?: UIMessageStreamWriter) {
  const p = await profile();
  // The topics by name and key, so a question about a topic is read as that topic (QA 2026-09-27: "What are people
  // saying about multiplayer and co-op?" read all 2,362 conversations). Without them the brief still stands.
  const topics = await topicLabels().catch(() => []);
  const brief = instructions(p, topics);
  const tools = makeTools(writer, p);
  const toolNames = Object.keys(tools) as (keyof typeof tools)[];
  const model = steady(chatModel());
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
            model: steady(answerModel()),
            messages: flattenForAnswer(messages),
            activeTools: [],
            toolChoice: "none" as const,
            instructions: brief + NO_TOOLS_LEFT,
          }
        : // A follow-up that asks for a kind, a topic or a period reads that slice before it answers (P3, flags.ts).
          stepNumber === 0 && followsUp(messages) && asksForSlice(lastQuestion(messages), topics)
          ? { activeTools: toolNames.filter((t) => t !== "out_of_scope"), toolChoice: "required" as const }
          : // A question for a number gets it from a tool (D11). Eval 2026-09-28 (A06): told the data's dates,
            // "How many conversations were about pricing last month?" was answered with no tool call, and a count
            // tagged [aggregate] that nothing had counted. out_of_scope stays offered: revenue is a number too.
            stepNumber === 0 && !asksWhatPeopleSay(lastQuestion(messages))
            ? { toolChoice: "required" as const }
            : // A turn that has only counted may not answer a question about what people say: counts carry no
              // messages, and such an answer quoted threads and a cause with nothing to cite (QA 2026-09-26,
              // grounding.ts). The step must call a reading tool; the step after it answers.
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
      model: steady(answerModel()),
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
/** A chat's earlier tool results, as the UI messages sent with a question carry them, in the shape of a turn's steps, so
 *  retrievedRefs and toolsRan read them as they read this turn's. QA 2026-09-27: "which of those are bugs?" answered
 *  from what the previous turn read, with no tool call, and every claim failed the check as "not retrieved". Only a
 *  part with its output counts; a call the reader stopped has none. */
export function chatToolSteps(
  messages: ReadonlyArray<{ parts: ReadonlyArray<unknown> }>,
): { content: { type: "tool-result"; toolName: string; output: unknown }[] }[] {
  return messages.map((m) => ({
    content: m.parts.flatMap((part) => {
      const p = part as { type: string; toolName?: string; state?: string; output?: unknown };
      const name =
        p.type === "dynamic-tool" ? p.toolName : p.type.startsWith("tool-") ? p.type.slice(5) : undefined;
      return name && p.state === "output-available"
        ? [{ type: "tool-result" as const, toolName: name, output: p.output }]
        : [];
    }),
  }));
}

/** The tools that gave a result in these steps; a refused call ran nothing. */
export function toolsRan(steps: ReadonlyArray<{ content: ReadonlyArray<unknown> }>): Set<string> {
  const ran = new Set<string>();
  for (const s of steps)
    for (const part of s.content) {
      const p = part as { type: string; toolName?: string; output?: unknown };
      if (p.type === "tool-result" && p.toolName && !isRefusal(p.output)) ran.add(p.toolName);
    }
  return ran;
}

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
