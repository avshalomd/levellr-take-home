import { z } from "zod";
import { topicsChanged } from "@/lib/data/insights";
import { editInstant, panel } from "@/lib/labels/store";
import { respond } from "../_respond";

const Edit = z.discriminatedUnion("op", [
  z.object({ op: z.literal("rename"), key: z.string(), name: z.string().min(1).max(60) }),
  z.object({ op: z.literal("describe"), key: z.string(), description: z.string().max(400) }),
  z.object({ op: z.literal("merge"), keys: z.array(z.string()).min(2).max(12), name: z.string().max(60), description: z.string().max(600).optional() }),
]);

// Rename, describe, combine: instant, no model call.
export async function POST(req: Request) {
  return respond(async () => {
    await editInstant(Edit.parse(await req.json()));
    topicsChanged(); // Explore's cached grid and names are read afresh (open item 2026-09-26)
    return panel();
  });
}
