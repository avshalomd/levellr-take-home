import { z } from "zod";
import { resume } from "@/lib/labels/store";
import { respond } from "../../_respond";

export async function POST(req: Request) {
  const { jobId } = z.object({ jobId: z.string() }).parse(await req.json());
  return respond(async () => resume(jobId));
}
