import { z } from "zod";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  toUIMessageStream,
} from "ai";
import { makeAgent } from "@/lib/agent/agent";
import { corroborate } from "@/lib/agent/corroborate";
import { afterAgent } from "@/lib/agent/finish";
import type { ChatMessage } from "@/lib/agent/ui-types";
import { friendly, modelIdOf } from "@/lib/llm/errors";

// One chat turn: the agent streams (text, tool calls, tool results, scan progress), then the verification pass
// streams its per-claim badges into the same message, then how many conversations back each claim. The client renders
// all of it as it arrives. Chats are not saved on the server (docs/DESIGN.md decision 10): the browser sends the chat
// so far with each question.

export const maxDuration = 300;

// The shape checked here is only what this route relies on; the parts themselves are the AI SDK's to read. A bad
// body is a 400 with one line, never a stream carrying a JavaScript error.
const Body = z.object({
  id: z.string().max(100).optional(),
  trigger: z.string().optional(),
  messages: z
    .array(
      z
        .object({
          id: z.string(),
          role: z.enum(["user", "assistant", "system"]),
          parts: z.array(z.object({ type: z.string() }).loose()),
        })
        .loose(),
    )
    .min(1)
    .max(200)
    .refine((m) => m.at(-1)?.role === "user", "the last message must be the user's question"),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "Send { messages: [...] } ending with the user's question." },
      { status: 400 },
    );
  const messages = parsed.data.messages as unknown as ChatMessage[];
  const startedAt = Date.now();

  const stream = createUIMessageStream<ChatMessage>({
    originalMessages: messages,
    onError: (e) => friendly(e),
    execute: async ({ writer }) => {
      const { agent, tools, model } = await makeAgent(writer);
      // A step the reader stopped has a call and no result, which a provider rejects; it is left out.
      const input = await convertToModelMessages(messages.slice(-12), {
        tools,
        ignoreIncompleteToolCalls: true,
      });
      const result = await agent.stream({
        messages: input,
        // It stops before the platform's 300 s limit: a stalled call otherwise hangs until the function is killed and
        // the reader gets a cut stream instead of an error with a Retry.
        abortSignal: AbortSignal.timeout(240_000),
      });

      // Forwarded chunk by chunk (not writer.merge) so the verification part below is guaranteed to come after
      // the last token of the answer.
      const reader = toUIMessageStream<typeof tools, ChatMessage>({
        stream: result.stream,
        tools,
        sendFinish: false,
        sendReasoning: false,
        // Without it the SDK writes "An error occurred." for every failed tool call and every error part. A refused
        // call is a result, not an error (lib/agent/tools.ts); what is still an error gets the same plain words as a
        // failed answer, never our own exception text.
        onError: (e) => friendly(e),
        messageMetadata: ({ part }) =>
          part.type === "start" ? { model: modelIdOf(model), startedAt } : undefined,
      }).getReader();
      for (let r = await reader.read(); !r.done; r = await reader.read()) writer.write(r.value);

      // The answer's post-steps - the off-topic reply, the cite pass, the check - are one shared function the eval
      // runs too (lib/agent/finish.ts); each part streams to the reader as it happens.
      const steps = await result.steps;
      // Every step's messages: in AI SDK 7 result.response is the last step's only, so the rates, changes and figures
      // this turn's tools gave would never reach the checks, nor its results the cite pass.
      const history = [...input, ...(await result.responseMessages)];
      const after = await afterAgent({ steps, history }, (chunk) => writer.write(chunk));

      // Then how many of the conversations this turn found back each claim, beyond the few it cites.
      if (after.checked) {
        writer.write({ type: "data-corroboration", id: "corroboration", data: { status: "running" } });
        const corroboration = await corroborate(after.checked, steps).catch((e) => ({
          status: "failed" as const,
          error: String(e).slice(0, 300),
        }));
        writer.write({ type: "data-corroboration", id: "corroboration", data: corroboration });
      }
      writer.write({ type: "message-metadata", messageMetadata: { ms: Date.now() - startedAt } });
      writer.write({ type: "finish" });
    },
  });
  return createUIMessageStreamResponse({ stream });
}
