import { getMessages, getMessagesByRef } from "@/lib/data/read";

// Full text for a handful of messages (the evidence panel opens one at a time; the thread tree only has previews).
// By id (?ids=t1_x,t1_y), or by the short ref an answer cites (?refs=12,40) for a cited message no tool returned.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const list = (k: string) => (params.get(k) ?? "").split(",").filter(Boolean).slice(0, 50);
  // A ref is a Postgres integer: anything outside it is simply not a message (and would overflow the query).
  const refs = list("refs")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 2_147_483_647);
  try {
    return Response.json(refs.length ? await getMessagesByRef(refs) : await getMessages(list("ids")));
  } catch (e) {
    console.error("messages read failed", e);
    return Response.json({ error: "The messages could not be read." }, { status: 500 });
  }
}
