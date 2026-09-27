"use client";

import { useEffect, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { THEME_COLOR } from "@/lib/app";
import { cn } from "@/lib/utils";

// The sun and moon everyone knows, top right on every page. On a first visit the theme is the computer's (and
// follows it if it changes); one click picks light or dark for this browser, overriding the computer from then on.
// It shows where a click takes you: a moon in light, a sun in dark. DECISIONS D20.

const noop = () => () => {};
const spring = { type: "spring", bounce: 0, duration: 0.3 } as const;

/** `corner`: the one floating in the desktop's top-right corner, which globals.css moves aside for the evidence panel. */
export function ThemeToggle({ className, corner = false }: { className?: string; corner?: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  // The theme is only known in the browser. Until the script knows it, the icon is picked by CSS from the class
  // next-themes puts on <html> before the first paint, so it is there at once rather than popping in (QA 2026-09-26).
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const dark = mounted && resolvedTheme === "dark";
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={mounted ? label : "Switch theme"}
      title={mounted ? label : undefined}
      data-theme-toggle
      data-corner-toggle={corner || undefined}
      className={cn(
        "pressable grid size-10 place-items-center overflow-hidden rounded-full text-foreground/75 transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pulse",
        className,
      )}
    >
      {mounted ? (
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={dark ? "sun" : "moon"}
            initial={{ opacity: 0, rotate: -90, scale: 0.6 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 90, scale: 0.6 }}
            transition={spring}
            className="grid place-items-center"
          >
            {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
          </motion.span>
        </AnimatePresence>
      ) : (
        <>
          <Moon className="size-[18px] dark:hidden" />
          <Sun className="hidden size-[18px] dark:block" />
        </>
      )}
    </button>
  );
}

// The browser's toolbar colour. The page's metadata picks it from the computer's setting (app/layout.tsx), which
// is right until the reader overrides the theme; from then on it follows the pick, so a phone's toolbar never
// stays light over a dark page.
export function ThemeColor() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", THEME_COLOR[resolvedTheme]));
  }, [resolvedTheme]);
  return null;
}
