import { z } from "zod";
import { topicsChanged } from "@/lib/data/insights";
import { step } from "@/lib/labels/store";
import { respond } from "../../_respond";

export const maxDuration = 60;

// One batch (~300 conversations). The response is the job's progress; the client calls again while it is "running".
export async function POST(req: Request) {
  const { jobId } = z.object({ jobId: z.string() }).parse(await req.json());
  return respond(async () => {
    const j = await step(jobId);
    // A relabel moves conversations only as it finishes (store.ts finish), so Explore's cached grid is read afresh
    // once the job stops running, not after every batch (open item 2026-09-26).
    if (j.status !== "running") topicsChanged();
    return { status: j.status, done: j.done, total: j.total, costUsd: j.costUsd, error: j.error };
  });
}
