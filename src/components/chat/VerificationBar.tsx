"use client";

import { useState } from "react";
import { ChevronDown, CircleAlert, CircleCheck } from "lucide-react";
import type { RevisionPart } from "@/lib/agent/revise";
import type { VerificationPart } from "@/lib/agent/ui-types";
import { cn } from "@/lib/utils";
import { plainClaim, verificationWords } from "./verification-words";

// The claim check in one plain sentence under the answer (verification-words.ts): "Checked: 7 of 8 claims are backed
// by the messages they cite". While it runs, a breathing dot; when it is done, the claims one click away, each marked
// backed or partly backed. Calm by design: the check reports, it does not alarm.

const BACKED = 0.5; // the verifier's own bar (lib/agent/verify.ts SUPPORTED)

export function VerificationBar({ v, revision }: { v?: VerificationPart; revision?: RevisionPart }) {
  const [open, setOpen] = useState(false);
  const words = verificationWords(v, revision);
  if (!words) return null;

  if (words.state === "checking" || words.state === "tightening")
    return (
      <p className="flex items-center gap-2 text-[13px] text-muted-foreground" aria-live="polite">
        <span className="breathe size-1.5 rounded-full bg-pulse" aria-hidden />
        {words.text}
      </p>
    );
  if (words.state === "quiet" && words.weak)
    return (
      <div className="text-[13px] text-muted-foreground">
        <p className="flex items-center gap-2">
          <CircleAlert className="size-4 shrink-0 text-warn" aria-label="Not backed" />
          {words.text}
        </p>
        {words.note && <p className="mt-1 pl-6">{words.note}</p>}
      </div>
    );
  if (words.state === "quiet") return <p className="text-[13px] text-muted-foreground">{words.text}</p>;

  const claims = v?.status === "done" ? v.claims.filter((c) => c.citations.length) : [];
  return (
    <div className="text-[13px] text-muted-foreground">
      {/* 20px of text: a transparent layer 2px above and below makes it a 24px target without moving anything (QA
          2026-09-26). */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group relative flex items-center gap-2 text-left before:absolute before:inset-x-0 before:-inset-y-[2px] hover:text-foreground"
      >
        {/* A check mark only beside a result that mostly holds; fewer than half backed gets a warning (QA 2026-09-27). */}
        {words.weak ? (
          <CircleAlert className="size-4 shrink-0 text-warn" aria-label="Weakly backed" />
        ) : (
          <CircleCheck className="size-4 shrink-0 text-pulse" aria-hidden />
        )}
        <span>{words.text}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 opacity-60 transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>
      {words.note && <p className="mt-1 pl-6">{words.note}</p>}
      {open && (
        <ul className="mt-3 space-y-2 pl-6">
          {claims.map((c, i) => {
            const backed = (c.support ?? 0) >= BACKED;
            const label = c.unchecked ? "not checked" : "partly backed";
            return (
              <li key={i} className="flex gap-2.5">
                <span
                  className={cn("mt-[7px] size-2 shrink-0 rounded-full", backed ? "bg-pulse" : "border border-dashed border-muted-foreground/60")}
                  aria-label={backed ? "Backed" : label === "not checked" ? "Not checked" : "Partly backed"}
                />
                <span className={cn("leading-relaxed", backed ? "text-foreground/80" : "text-muted-foreground")}>
                  {plainClaim(c.claim)}
                  {!backed && <span className="text-muted-foreground"> ({label})</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
