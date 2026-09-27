import { getThread } from "@/lib/data/read";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const thread = await getThread(id);
  return thread ? Response.json(thread) : Response.json({ error: "no such thread" }, { status: 404 });
}
