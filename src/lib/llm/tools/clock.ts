import { tool } from "ai";
import { z } from "zod";

// The example tool: the model does not know today's date, so an agent that reasons about dates asks for it.
// A tool is a description (the model reads it to decide when to call), an input schema (checked before execute
// runs) and execute (plain server code: a database query, a fetch, a calculation). Copy this file for a new tool.
export const clock = tool({
  description: "Get the current date and time. Call it before reasoning about any relative date.",
  inputSchema: z.object({
    timeZone: z.string().describe("IANA time zone, e.g. Europe/Oslo").default("UTC"),
  }),
  execute: async ({ timeZone }) => {
    const now = new Date();
    return {
      iso: now.toISOString(),
      local: now.toLocaleString("en-GB", { timeZone, dateStyle: "full", timeStyle: "short" }),
      timeZone,
    };
  },
});
