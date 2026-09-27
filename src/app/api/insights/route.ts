import { getGrid } from "@/lib/data/insights";
import { isResolution } from "@/lib/data/insights-model";

// The Explore grid for one resolution: conversations, reactions, messages, mood and people for every topic x period cell, plus period and topic totals, the
// dataset norm and the event markers. GET /api/insights?res=day|week|month (default week). A database failure is a
// plain 500 with no detail; the page shows its own "did not load" line with a retry.
export async function GET(req: Request) {
  const res = new URL(req.url).searchParams.get("res") ?? "week";
  if (!isResolution(res)) return Response.json({ error: "res must be day, week or month" }, { status: 400 });
  try {
    return Response.json(await getGrid(res), {
      headers: { "Cache-Control": "private, no-cache" }, // cheap: the server caches it per data version
    });
  } catch (e) {
    console.error("insights grid failed", e);
    return Response.json({ error: "The grid could not be read." }, { status: 500 });
  }
}
