import { NextResponse, type NextRequest } from "next/server";
import { TENANT_COOKIE } from "./lib/tenant-cookie";

// Give every browser a stable anonymous id so the demo's agents and stats are isolated
// per visitor instead of shared across everyone. The id is also forwarded onto this same
// request so the first page load already resolves to its own (empty) sandbox.
export function middleware(req: NextRequest) {
  if (req.cookies.get(TENANT_COOKIE)?.value) {
    return NextResponse.next();
  }

  const sid = crypto.randomUUID();
  const headers = new Headers(req.headers);
  const existing = headers.get("cookie");
  headers.set("cookie", existing ? `${existing}; ${TENANT_COOKIE}=${sid}` : `${TENANT_COOKIE}=${sid}`);

  const res = NextResponse.next({ request: { headers } });
  res.cookies.set(TENANT_COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logos/).*)"],
};
