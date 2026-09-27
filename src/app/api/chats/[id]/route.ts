import { z } from "zod";
import { deleteChat, getChat, keepChat } from "@/lib/data/chats";
import type { ChatMessage } from "@/lib/agent/ui-types";
import { ownerId } from "@/lib/owner";

export async function GET(_req: Request, { params }: RouteContext<"/api/chats/[id]">) {
  const owner = await ownerId();
  const chat = owner ? await getChat((await params).id, owner) : null;
  return chat ? Response.json(chat) : Response.json({ error: "not found" }, { status: 404 });
}

// The reader stopped an answer: the chat as their screen shows it replaces the saved one (data/chats.ts keepChat).
const Keep = z.object({
  messages: z.array(z.object({ id: z.string(), role: z.enum(["user", "assistant", "system"]), parts: z.array(z.object({ type: z.string() }).loose()) }).loose()).max(200),
});

export async function PUT(req: Request, { params }: RouteContext<"/api/chats/[id]">) {
  const owner = await ownerId();
  const body = Keep.safeParse(await req.json().catch(() => null));
  if (!owner) return Response.json({ error: "no owner" }, { status: 401 });
  if (!body.success) return Response.json({ error: "Send { messages: [...] }." }, { status: 400 });
  await keepChat((await params).id, owner, body.data.messages as unknown as ChatMessage[]);
  return new Response(null, { status: 204 });
}

export async function DELETE(_req: Request, { params }: RouteContext<"/api/chats/[id]">) {
  const owner = await ownerId();
  if (owner) await deleteChat((await params).id, owner);
  return new Response(null, { status: 204 });
}
