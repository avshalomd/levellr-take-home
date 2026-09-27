/** The commit this deployment runs, so a QA run can say what it tested (QA P16: every CLI deploy said "local"). A CLI
 *  deploy sets it with `vercel deploy --prod --yes --env APP_COMMIT=$(git rev-parse --short HEAD)`; a Git deploy has
 *  Vercel's own VERCEL_GIT_COMMIT_SHA. "local" when neither is set, as under `next dev`. */
export function commitOf(env: Record<string, string | undefined> = process.env): string {
  return env.APP_COMMIT?.trim() || env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 7) || "local";
}
