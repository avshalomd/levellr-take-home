// The topic workflow from a terminal - the same code Explore's topic editor calls (src/lib/labels/*).
//   npm run labels -- status
//   npm run labels -- relabel --file labels.json [--yes]  price a label set, and with --yes run the relabel to the end
//   npm run labels -- resume <jobId>                      finish a relabel an outage stopped (its done batches are kept)
//   npm run labels -- export                              write the active set to data/work/topics.json, so a data
//                                                         reload (ingest/load.py) labels with the team's edits
//   npm run labels -- seed-spend                          record ingest's cost (data/work/spend.json) in the spend
//                                                         table once, so the $3 cap covers the build and the app
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { query } from "@/lib/data/db";
import { active, budget, latestJob, propose, resume, start, step } from "@/lib/labels/store";
import type { Label } from "@/lib/labels/taxonomy";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const flag = (k: string) => process.argv.includes(`--${k}`);
const TOPICS = "data/work/topics.json";
const SPEND = "data/work/spend.json";

async function main() {
  const cmd = process.argv[2];
  if (cmd === "status") {
    const [a, b] = await Promise.all([active(), budget()]);
    console.log(`label set v${a.version} (${a.source}: ${a.note}); spent $${b.spentUsd} of $${b.capUsd}`);
    for (const l of a.labels) console.log(`  ${String(l.n).padStart(5)}  ${l.name} - ${l.description}`);
    const j = await latestJob();
    if (j)
      console.log(
        `last relabel ${j.id}: ${j.status} ${j.done}/${j.total}, $${j.costUsd}, ${j.skipped} skipped${j.error ? ` - ${j.error}` : ""}`,
      );
    return;
  }
  if (cmd === "relabel") {
    const labels: Label[] = JSON.parse(readFileSync(arg("file")!, "utf8"));
    for (const l of labels) console.log(`  ${l.name} - ${l.description}`);
    const p = await propose(labels);
    console.log(
      `relabel ${p.estimate.conversations} conversations: ~${p.estimate.tokens} tokens, ~$${p.estimate.usd} (spent $${p.budget.spentUsd} of $${p.budget.capUsd})`,
    );
    if (!flag("yes")) return console.log("dry run: add --yes to run it");
    return run(await start(p.draftId));
  }
  if (cmd === "resume") return run(await resume(process.argv[3]));
  if (cmd === "export") {
    // topics.json keeps everything else it holds (the mood target), and takes the active labels without "other",
    // which enrich.py never asks about.
    const prev = existsSync(TOPICS) ? JSON.parse(readFileSync(TOPICS, "utf8")) : {};
    const a = await active();
    const labels = a.labels.filter((l) => l.key !== "other").map(({ key, name, description }) => ({ key, name, description }));
    writeFileSync(TOPICS, JSON.stringify({ ...prev, labels }, null, 2) + "\n");
    return console.log(`wrote ${labels.length} topics (label set v${a.version}) to ${TOPICS}`);
  }
  if (cmd === "seed-spend") {
    const s = JSON.parse(readFileSync(SPEND, "utf8")) as { total_usd: number; by_kind: Record<string, { tokens: number }> };
    const tokens = Object.values(s.by_kind).reduce((n, k) => n + (k.tokens ?? 0), 0);
    // One row, replaced on a re-run, so seeding twice never counts ingest twice.
    await query(`DELETE FROM spend WHERE kind = 'ingest'`);
    await query(`INSERT INTO spend (kind, tokens, usd, note) VALUES ('ingest', $1, $2, $3)`, [tokens, s.total_usd, SPEND]);
    return console.log(`recorded ingest's $${s.total_usd.toFixed(4)} in spend`);
  }
  console.log("usage: status | relabel --file f [--yes] | resume <jobId> | export | seed-spend");
}

async function run(j: Awaited<ReturnType<typeof start>>) {
  const t0 = Date.now();
  while (j.status === "running") {
    j = await step(j.id);
    console.log(`  ${j.done}/${j.total}  $${j.costUsd.toFixed(4)}  ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  console.log(`relabel ${j.status}, ${j.skipped} skipped${j.error ? `: ${j.error}` : ""}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
