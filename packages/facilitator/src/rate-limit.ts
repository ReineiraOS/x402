import type { Context, MiddlewareHandler } from "hono";

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

function clientKey(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]!.trim();
  }
  return c.req.header("x-real-ip") ?? "unknown";
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return async (c, next) => {
    const now = Date.now();
    const key = clientKey(c);
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
    } else if (entry.count >= options.max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header("retry-after", String(retryAfter));
      return c.json({ error: "rate_limited" }, 429);
    } else {
      entry.count += 1;
    }

    if (hits.size > 10_000) {
      for (const [k, v] of hits) {
        if (v.resetAt <= now) {
          hits.delete(k);
        }
      }
    }

    return next();
  };
}
