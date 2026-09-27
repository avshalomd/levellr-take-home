import { listChats } from "@/lib/data/chats";
import { ownerId } from "@/lib/owner";

// This browser's saved chats, newest first.
export async function GET() {
  const owner = await ownerId();
  return Response.json(owner ? await listChats(owner) : []);
}
