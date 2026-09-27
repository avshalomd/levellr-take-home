import { z } from "zod";
import { propose } from "@/lib/labels/store";
import { respond } from "../_respond";

const Body = z.object({
  labels: z.array(z.object({ key: z.string().optional(), name: z.string().max(60), description: z.string().max(400) })).min(2).max(20),
});

// A label set that changes meaning: priced and stored as a draft. Nothing is labelled until /backfill.
export async function POST(req: Request) {
  return respond(async () => propose(Body.parse(await req.json()).labels));
}
