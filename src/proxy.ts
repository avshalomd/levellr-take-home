import { NextResponse, type NextRequest } from "next/server";

// Gives each browser an anonymous id on its first visit (a random UUID in an http-only cookie, a year long), so its
// saved chats come back after a reload. No account, no personal data; clearing cookies starts a fresh history.
export function proxy(req: NextRequest) {
  const res = NextResponse.next();
  if (!req.cookies.get("cp_owner"))
    res.cookies.set("cp_owner", crypto.randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
  return res;
}

export const config = { matcher: ["/((?!_next/|favicon|.*\\.(?:png|svg|ico|webp)$).*)"] };
