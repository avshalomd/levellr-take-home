// Run one SQL statement against DATABASE_URL: npm run sql -- "alter table x add column y text"
// Use it when `npm run db:push` would prompt (renames, NOT NULL on a table with rows) - drizzle-kit cannot answer
// prompts without a terminal. Keep src/db/schema.ts in step with whatever you run here.
import { neon } from "@neondatabase/serverless";

const statement = process.argv.slice(2).join(" ");
if (!statement) throw new Error('usage: npm run sql -- "<statement>"');
neon(process.env.DATABASE_URL!)
  .query(statement)
  .then((rows) => console.log(JSON.stringify(rows, null, 2).slice(0, 2000)))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
