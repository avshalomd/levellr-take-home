import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Baseline table so the pipeline (push, health check, deploy) was proven before the task started.
// Keep it: src/db/transaction.int.test.ts uses it. Add the task tables beside it.
export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
