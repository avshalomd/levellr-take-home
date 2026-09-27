import { z } from "zod";
import { cancel } from "@/lib/labels/store";
import { respond } from "../../_respond";

export async function POST(req: Request) {
  const { jobId } = z.object({ jobId: z.string() }).parse(await req.json());
  return respond(async () => cancel(jobId));
}
