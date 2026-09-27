import { z } from "zod";
import { getSelection } from "@/lib/data/insights";

// A selection's combined numbers and its busiest threads. POST { ranges: [{ topic, from, to }] }, one range per
// topic per run of consecutive periods, dates as YYYY-MM-DD with `to` exclusive. The client merges cells into ranges.
// A date must be a real day (2026-02-30 is refused here, not by the database), and a database failure is a plain 500
// with no detail.
const isRealDay = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
};
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDay, "not a real date");
const Body = z.object({
  ranges: z
    .array(z.object({ topic: z.string().min(1).max(200), from: Day, to: Day }).refine((r) => r.from < r.to, "from must be before to"))
    .min(1)
    .max(2000),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, { status: 400 });
  try {
    return Response.json(await getSelection(parsed.data.ranges));
  } catch (e) {
    console.error("insights selection failed", e);
    return Response.json({ error: "The selection could not be read." }, { status: 500 });
  }
}
