// Seed script: `npm run seed` (reads DATABASE_URL from .env.local). Keep it idempotent.
// It builds its own client because `@/db` imports `server-only`, which throws outside Next.
// Seed enough data that every screen is demoable even when the LLM is unavailable.
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../src/db/schema";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

async function main() {
  const existing = await db.select().from(schema.notes).limit(1);
  if (existing.length === 0) await db.insert(schema.notes).values({ body: "seeded" });
  console.log("seed done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
