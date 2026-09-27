import { z } from "zod";
import { topicsChanged } from "@/lib/data/insights";
import { start } from "@/lib/labels/store";
import { respond } from "../_respond";

// Confirm a draft: the relabel starts; the client then drives it with /backfill/step. A draft that only removes topics
// asks nothing, so it is applied here at once (store.ts start) and Explore's cached grid is read afresh.
export async function POST(req: Request) {
  const { draftId } = z.object({ draftId: z.string() }).parse(await req.json());
  return respond(async () => {
    const job = await start(draftId);
    if (job.status === "done") topicsChanged();
    return { jobId: job.id, job };
  });
}
