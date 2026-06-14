import { cookies } from "next/headers";
import { TENANT_COOKIE } from "./tenant-cookie";

export { TENANT_COOKIE };

// Per-browser tenant id, issued by middleware as an httpOnly cookie. The doc store keys are
// scoped by it so concurrent public visitors get isolated agents/sessions instead of one
// shared global document. Falls back to a shared bucket only when read outside a request.
export async function getTenantId(): Promise<string> {
  try {
    const jar = await cookies();
    const sid = jar.get(TENANT_COOKIE)?.value;
    if (sid && /^[A-Za-z0-9_-]{8,64}$/.test(sid)) {
      return sid;
    }
  } catch {
    // not in a request scope
  }
  return "shared";
}
