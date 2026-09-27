import { getOverview } from "@/lib/data/read";

// The overview the chat names topics and channels from: the dataset's window, counts, channels and topic labels.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getOverview());
  } catch (e) {
    console.error("overview read failed", e);
    return Response.json({ error: "The overview could not be read." }, { status: 500 });
  }
}
