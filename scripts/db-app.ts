// Applies db/app.sql (the tables the app itself writes). usage: npm run db:app
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!);
  for (const stmt of readFileSync("db/app.sql", "utf8").replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean))
    await sql.query(stmt);
  const [row] = (await sql.query("SELECT count(*)::int AS n FROM chats")) as { n: number }[];
  console.log(`db/app.sql applied; chats has ${row.n} rows`);
}
main();
