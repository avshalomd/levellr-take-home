"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyInstant,
  reconcile,
  type DraftEdit,
  type InstantEdit,
  type Taxonomy,
} from "@/lib/data/insights-labels";

// The label set and everything that changes it, from the Explore page's side: GET /api/taxonomy and its edits. Instant
// edits are optimistic; a relabel is driven step by step from here, and can be paused (the job waits) or cancelled.

/** A priced draft (POST /api/taxonomy/propose). `asks`: the topics asked again (new or redefined), by name; `removes`:
 *  the topics taken off, free. A draft with nothing to ask is applied at once when it is confirmed. */
export type Proposal = {
  draftId: string;
  estimate: { conversations: number; tokens: number; usd: number };
  affordable: boolean;
  asks: string[];
  removes: string[];
};

type Step = { status: string; done: number; total: number; costUsd: number; error?: string | null };

async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `The request failed (${res.status}).`);
  return json as T;
}

export function useTaxonomy({ onLabelsChanged }: { onLabelsChanged: () => void }) {
  const [tax, setTax] = useState<Taxonomy | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [pending, setPending] = useState<DraftEdit[]>([]);
  const [driving, setDriving] = useState(false); // this tab is stepping the running job
  const [startedAt, setStartedAt] = useState<{ at: number; done: number } | null>(null);
  const stop = useRef(false);
  const changed = useRef(onLabelsChanged);
  useEffect(() => {
    changed.current = onLabelsChanged;
  }, [onLabelsChanged]);

  const load = useCallback(async () => {
    try {
      const t = await call<Taxonomy>("/api/taxonomy");
      setTax(t);
      setPending((p) => reconcile(p, t.active.labels));
      setUnavailable(false);
      return t;
    } catch {
      setUnavailable(true); // the grid keeps the names the page was rendered with
      return null;
    }
  }, []);

  useEffect(() => {
    // Loading on mount is the effect's whole job; the state it sets is the fetched taxonomy.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // A relabel that another window (or a script) is stepping: follow its progress without driving it.
  const watching = tax?.job?.status === "running" && !driving;
  useEffect(() => {
    if (!watching) return;
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [watching, load]);

  /** Rename, describe or combine: shown at once, confirmed (or rolled back) by the server. */
  const edit = useCallback(
    async (e: InstantEdit) => {
      if (!tax) return;
      const before = tax;
      setTax({ ...tax, active: { ...tax.active, labels: applyInstant(tax.active.labels, e) } });
      try {
        const next = await call<Taxonomy>("/api/taxonomy/edit", e);
        setTax(next);
        setPending((p) => reconcile(p, next.active.labels));
        if (e.op === "merge") changed.current(); // conversations moved to a new key: the grid must re-read
      } catch (err) {
        setTax(before);
        throw err;
      }
    },
    [tax],
  );

  const propose = useCallback(
    (labels: { key?: string; name: string; description: string }[]) => call<Proposal>("/api/taxonomy/propose", { labels }),
    [],
  );


  /** Step the job until it finishes, fails, is cancelled, or the reader pauses. */
  const drive = useCallback(
    async (jobId: string): Promise<"done" | "failed" | "cancelled" | "paused" | "error"> => {
      stop.current = false;
      setDriving(true);
      setStartedAt(null);
      try {
        for (;;) {
          if (stop.current) return "paused";
          const s = await call<Step>("/api/taxonomy/backfill/step", { jobId });
          setStartedAt((x) => x ?? { at: Date.now(), done: s.done });
          setTax((t) => (t && t.job ? { ...t, job: { ...t.job, status: s.status as NonNullable<Taxonomy["job"]>["status"], done: s.done, total: s.total, costUsd: s.costUsd, error: s.error ?? null } } : t));
          if (s.status !== "running") {
            if (s.status === "done") {
              setPending([]);
              changed.current();
            }
            await load();
            return s.status === "done" ? "done" : s.status === "cancelled" ? "cancelled" : "failed";
          }
        }
      } catch {
        await load();
        return "error";
      } finally {
        setDriving(false);
      }
    },
    [load],
  );

  const start = useCallback(
    async (draftId: string) => {
      const r = await call<{ jobId: string }>("/api/taxonomy/backfill", { draftId });
      await load();
      return drive(r.jobId);
    },
    [drive, load],
  );

  const pause = useCallback(() => {
    stop.current = true;
  }, []);

  const cancel = useCallback(
    async (jobId: string) => {
      stop.current = true;
      await call("/api/taxonomy/backfill/cancel", { jobId });
      await load();
    },
    [load],
  );

  return { tax, unavailable, pending, setPending, edit, propose, start, drive, pause, cancel, driving, startedAt, reload: load };
}
