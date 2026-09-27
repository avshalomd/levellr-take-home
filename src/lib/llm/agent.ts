import "server-only";
import { isStepCount, ToolLoopAgent, type LanguageModel, type ToolSet } from "ai";
import { getModel } from "@/lib/ai";
import { LlmError, modelIdOf, toLlmError } from "./errors";

// Template 2: an agent - the model calls tools in a loop until it can answer. AI SDK's ToolLoopAgent runs the loop;
// this wrapper adds what product code needs: a step cap, a timeout, the LlmError messages, and a trace of every
// tool call so the UI can show what the agent did and why.
// A tool is one file in src/lib/llm/tools/ (see clock.ts). To connect one, put it in the `tools` object.

export type TraceEntry = { step: number; tool: string; input: unknown; output?: unknown; error?: string };

export type RunAgentArgs = {
  instructions: string; // the agent's job, its rules, and when to stop and answer
  tools: ToolSet; // { name: tool({...}) }; the model sees each tool's description and input schema
  prompt: string; // the user's request for this run
  maxSteps?: number; // a hard cap on model calls: a loop that never answers costs money and time
  timeoutMs?: number; // for the whole run, all steps included
  model?: () => LanguageModel;
};

export type AgentResult = {
  text: string; // the final answer; empty when the cap was hit first
  trace: TraceEntry[];
  steps: number;
  hitStepCap: boolean; // true when the agent was still calling tools at the cap: show it, never pass it off as an answer
  modelId: string;
};

export async function runAgent({
  instructions,
  tools,
  prompt,
  maxSteps = 8,
  timeoutMs = 60_000,
  model = getModel,
}: RunAgentArgs): Promise<AgentResult> {
  try {
    const m = model();
    const agent = new ToolLoopAgent({ model: m, instructions, tools, stopWhen: isStepCount(maxSteps), maxRetries: 1 });
    const result = await agent.generate({ prompt, timeout: timeoutMs });
    return {
      text: result.text,
      trace: traceOf(result.steps),
      steps: result.steps.length,
      hitStepCap: result.finishReason === "tool-calls",
      modelId: modelIdOf(m),
    };
  } catch (e) {
    throw toLlmError(e, timeoutMs);
  }
}

// A tool that throws does not end the run: the SDK hands the error back to the model as the tool's result, and it
// can try another way. The trace keeps both outcomes.
function traceOf(steps: ReadonlyArray<{ content: ReadonlyArray<unknown> }>): TraceEntry[] {
  return steps.flatMap((s, i) =>
    s.content.flatMap((part): TraceEntry[] => {
      const p = part as { type: string; toolName?: string; input?: unknown; output?: unknown; error?: unknown };
      if (p.type === "tool-result") return [{ step: i + 1, tool: p.toolName!, input: p.input, output: p.output }];
      if (p.type === "tool-error") return [{ step: i + 1, tool: p.toolName!, input: p.input, error: String(p.error) }];
      return [];
    }),
  );
}

export { LlmError };
