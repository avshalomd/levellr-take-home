import "server-only";
import { cookies } from "next/headers";

// The anonymous owner id that scopes saved chats to one browser. Set by src/proxy.ts on the first request.
export const OWNER_COOKIE = "cp_owner";

export async function ownerId(): Promise<string | null> {
  const v = (await cookies()).get(OWNER_COOKIE)?.value;
  return v && /^[0-9a-f-]{36}$/.test(v) ? v : null;
}
