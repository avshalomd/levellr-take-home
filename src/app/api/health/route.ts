import { sql } from "drizzle-orm";
import { generateText } from "ai";
import { db, dbConfigured } from "@/db";
import { aiProvider, getModel } from "@/lib/ai";
import { toLlmError } from "@/lib/llm/errors";

export const dynamic = "force-dynamic";

// GET /api/health          -> database check (the deploy gate)
// GET /api/health?deep=1   -> also makes one tiny model call, so "configured" is never mistaken for "usable"
export async function GET(req: Request) {
  let database: "up" | "down" | "unconfigured" = "unconfigured";
  if (dbConfigured) {
    try {
      await db.execute(sql`select 1`);
      database = "up";
    } catch {
      database = "down";
    }
  }

  const ai: { provider: string; usable?: boolean; error?: string } = { provider: aiProvider() };
  if (new URL(req.url).searchParams.get("deep") === "1" && ai.provider !== "none") {
    try {
      await generateText({ model: getModel(), prompt: "Reply with: ok", maxOutputTokens: 5, timeout: 15_000 });
      ai.usable = true;
    } catch (e) {
      ai.usable = false;
      // The provider's own words (rate limited, slug retired, parameter refused), not the gateway's
      // "Provider returned error": this line is what deploy.sh points at when the model is down in production.
      ai.error = toLlmError(e, 15_000).message.slice(0, 300);
    }
  }

  const ok = database === "up";
  return Response.json(
    { ok, database, ai, commit: process.env.APP_COMMIT ?? "local" },
    { status: ok ? 200 : 503 },
  );
}
