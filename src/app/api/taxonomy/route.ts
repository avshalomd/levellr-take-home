import { panel } from "@/lib/labels/store";

// The label set, the latest relabel, the budget and what the mood is measured towards: everything the topics editor
// shows. Contract: src/lib/labels/store.ts.
export async function GET() {
  return Response.json(await panel());
}
