// A label operation's refusal (a rule, the budget, a running relabel) is the reader's to see, as a 400 with the reason.
export async function respond(fn: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await fn());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
