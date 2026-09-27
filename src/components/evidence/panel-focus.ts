// Keyboard focus around the evidence panel (EvidenceSheet.tsx), and keeping the open conversation's tab in view
// (EvidencePanel.tsx). Opening the panel moves focus into it; closing it (Esc, the close button, the scrim, a drag)
// puts focus back on the citation chip that opened it, so a keyboard reader carries on from where they were. The
// decisions are small functions over plain values, so they are unit-tested (panel-focus.test.ts) without a browser.

/** Where focus returns when the panel closes: the element that had it when the panel opened. */
export type Opener = { el: HTMLElement; cite?: string; scope?: Element | null };

/** Remember what had focus as the panel opened. Nothing is remembered when focus was on the page itself. */
export function openerOf(el: Element | null): Opener | null {
  if (!(el instanceof HTMLElement) || el === document.body) return null;
  return { el, cite: el.dataset.cite, scope: el.closest("[data-message]") };
}

/**
 * The element to focus when the panel closes: the opener if it is still on the page; else, when the answer was drawn
 * again and its chip replaced (a corrected answer arriving, say), the chip with the same citation in the same answer.
 */
export function returnTarget(o: Opener): HTMLElement | null {
  if (o.el.isConnected) return o.el;
  if (o.cite && o.scope?.isConnected) return o.scope.querySelector<HTMLElement>(`[data-cite="${o.cite}"]`);
  return null;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The elements Tab can reach inside `root`, in order; hidden ones are left out. */
export const focusablesIn = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);

/**
 * Tab inside a sheet that covers the page: from the last element forward goes to the first, from the first (or the
 * sheet itself) back goes to the last. Null means the browser's own move stays inside, so it is left alone. Where the
 * focus is on something the list does not name (a scrolling box the browser made focusable), its place in the page
 * decides, so a Tab from the middle is never taken for a Tab from outside (review 2026-09-26).
 */
export function wrapTarget<T>(items: T[], current: T | null, back: boolean, precedes: (a: T, b: T) => boolean, sheet?: T): T | null {
  if (!items.length) return null;
  const first = items[0];
  const last = items[items.length - 1];
  if (current === null || current === sheet) return back ? last : first;
  if (back) return current === first || precedes(current, first) ? last : null;
  return current === last || precedes(last, current) ? first : null;
}

/** Whether `a` comes before `b` in the page. */
export const precedesInPage = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

/**
 * How far to scroll a horizontal strip so an item in it is fully visible, the least distance either way (the
 * "nearest" rule), with `pad` of room beside it. 0 when it is already visible. Only the strip scrolls: the browser's
 * scrollIntoView would also scroll the panel's own clipped column while it is still opening.
 */
export function nearestScroll(view: { left: number; right: number }, item: { left: number; right: number }, pad = 0): number {
  if (item.left - pad < view.left) return item.left - pad - view.left;
  if (item.right + pad > view.right) return item.right + pad - view.right;
  return 0;
}

/** How the strip moves to the open tab: at once when the strip has just been put on the page (a glide from its start
 *  replays a scroll the reader never made), or when the reader asks for less motion; smoothly otherwise. */
export const stripScrollBehavior = (fresh: boolean, reduceMotion: boolean): ScrollBehavior => (fresh || reduceMotion ? "auto" : "smooth");
