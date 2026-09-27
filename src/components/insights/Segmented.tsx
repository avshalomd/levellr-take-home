"use client";

import { motion, useReducedMotion } from "motion/react";
import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

/** Critically damped: settles without overshoot. The house spring for anything that answers a click. */
export const SPRING = { type: "spring", bounce: 0, duration: 0.35 } as const;
export const useSpring = () => (useReducedMotion() ? { duration: 0 } : SPRING);

export type Option<T extends string> = { value: T; label: string; hint?: string };

/**
 * A segmented control: one track, a pill that slides to the chosen segment. Groups sit side by side as separate
 * tracks but share one pill, so choosing across groups still reads as one choice. Arrow keys move between segments.
 */
export function Segmented<T extends string>({
  id,
  label,
  groups,
  value,
  onChange,
  size = "md",
  className,
}: {
  id: string;
  label: string;
  groups: Option<T>[][];
  value: T;
  onChange: (v: T) => void;
  /** "fit": small below 640px of the nearest @container, decided in CSS. Sized from a JS measurement, the controls
   * shrank just after the first paint and the chosen pill slid across the legend on every phone load (QA 2026-09-25). */
  size?: "sm" | "md" | "fit";
  className?: string;
}) {
  const spring = useSpring();
  const flat = groups.flat();
  const refs = useRef(new Map<T, HTMLButtonElement>());

  const onKey = (e: KeyboardEvent) => {
    const i = flat.findIndex((o) => o.value === value);
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? i + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const o = flat[(next + flat.length) % flat.length];
    onChange(o.value);
    refs.current.get(o.value)?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKey} className={cn("flex items-center gap-1.5", className)}>
      {groups.map((g, gi) => (
        <div key={gi} className="flex shrink-0 items-center rounded-full bg-foreground/[0.055] p-[3px] dark:bg-foreground/10">
          {g.map((o) => {
            const on = o.value === value;
            return (
              <button
                key={o.value}
                ref={(el) => {
                  if (el) refs.current.set(o.value, el);
                }}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                title={o.hint}
                onClick={() => onChange(o.value)}
                className={cn(
                  "relative rounded-full font-medium whitespace-nowrap transition-colors",
                  size === "sm"
                    ? "h-7 px-2.5 text-[13px]"
                    : size === "fit"
                      ? "h-8 px-3.5 text-sm @max-[640px]:h-7 @max-[640px]:px-2.5 @max-[640px]:text-[13px]"
                      : "h-8 px-3.5 text-sm",
                  on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {on && (
                  <motion.span
                    layoutId={`${id}-pill`}
                    transition={spring}
                    className="absolute inset-0 rounded-full bg-background shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_0.5px_rgb(0_0_0/0.06)] dark:bg-foreground/15"
                  />
                )}
                <span className="relative">{o.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
