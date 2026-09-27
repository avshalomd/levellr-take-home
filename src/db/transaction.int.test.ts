// Proves the transaction helper commits and rolls back against the real database. `npm run test:int`
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, transaction } from "@/db";
import { notes } from "@/db/schema";

describe.skipIf(!process.env.DATABASE_URL)("transaction()", () => {
  it("rolls back every write when the callback throws", async () => {
    const body = `tx-rollback-${Date.now()}`;
    await expect(
      transaction(async (tx) => {
        await tx.insert(notes).values({ body });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await db.select().from(notes).where(eq(notes.body, body))).toHaveLength(0);
  });

  it("commits when the callback returns", async () => {
    const body = `tx-commit-${Date.now()}`;
    const id = await transaction(async (tx) => (await tx.insert(notes).values({ body }).returning())[0].id);
    const rows = await db.select().from(notes).where(eq(notes.id, id));
    expect(rows).toHaveLength(1);
    await db.delete(notes).where(eq(notes.id, id));
  });
});
