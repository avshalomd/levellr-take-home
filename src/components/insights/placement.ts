// Where the Explore page's floating pieces go: the phone sheet and the grid's tooltip. Plain arithmetic on rectangles
// the components measure, so it is pinned by placement.test.ts without a browser.

/**
 * The selection sheet's left and right insets, in px from the screen edges. The sheet is fixed to the screen, so on
 * its own it centres on the whole window and, at tablet widths with the sidebar showing, sat half over the sidebar
 * (QA 2026-09-25). Anchoring it to the page column's edges centres it on the page instead, whatever the sidebar does.
 */
export function sheetInsets(column: { left: number; right: number }, viewportWidth: number, gutter = 12) {
  return { left: Math.max(0, column.left) + gutter, right: Math.max(0, viewportWidth - column.right) + gutter };
}

/**
 * The tooltip's top-left corner: centred above the square, pushed back inside the window when it would run off the
 * left or right edge, and dropped below the square when there is no room above it. `ceiling` is the top of the squares
 * (the dates sit above it): a tooltip that would reach above it goes below the square instead, as long as it fits
 * there, since over a top-row square it covered the month names while the arrows moved along the row (QA 2026-09-26).
 */
export function placeTip(
  cell: { x: number; top: number; bottom: number; ceiling?: number }, // x: the square's centre
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 8, // between the square and the tooltip
  margin = 8, // the closest the tooltip comes to the window's edge
): { left: number; top: number } {
  const maxLeft = Math.max(margin, viewport.width - margin - tip.width);
  const left = Math.min(Math.max(cell.x - tip.width / 2, margin), maxLeft);
  const above = cell.top - gap - tip.height;
  const below = cell.bottom + gap;
  if (above >= Math.max(margin, cell.ceiling ?? margin)) return { left, top: above };
  const fitsBelow = below + tip.height <= viewport.height - margin;
  return { left, top: fitsBelow || above < margin ? below : above };
}
