# Prepare repo for Vercel deployment (2026-06-14)

Scope (confirmed with user): deploy **demo + facilitator** as two Vercel projects.
Persistence: migrate file-based stores to **Neon Postgres**. Action: **prepare only** (no deploy run).

Not deployable to Vercel: `packages/rss`, `packages/contracts` (Solidity/Foundry) — documented, untouched.

## Blocker found

`apps/demo` persists agent + session state by writing JSON files to `process.cwd()`
(`.agent-store.json`, `.session-store.json`). Vercel's serverless FS is read-only — these
writes throw EROFS. Only these two files write to disk (grep-verified).

## Plan

### A. Storage migration (Neon Postgres, file fallback for local)

- [ ] `apps/demo/lib/store/docStore.ts` — backend-agnostic single-document store.
      Backend = `postgres` when `DATABASE_URL`/`POSTGRES_URL` set, else `file`.
      Postgres: `kv_store(key text pk, value jsonb, updated_at)`, schema auto-created.
- [ ] `agentStore.ts` — swap `readStore`/`writeStore`/`withLock` to the factory; logic unchanged.
- [ ] `sessionStore.ts` — same swap; logic unchanged.
- [ ] Add `@neondatabase/serverless` dependency.

### B. Demo Vercel config

- [ ] `apps/demo/vercel.json` — build workspace libs (`^...`) then `next build`.
- [ ] `FACILITATOR_URL` already env-driven → point at deployed facilitator (doc).

### C. Facilitator Vercel config

- [ ] `packages/facilitator/vercel.json` — add `buildCommand` to build its workspace deps.

### D. Repo-level prep

- [ ] Root `.env.example` — add `DATABASE_URL` (Neon).
- [ ] `DEPLOY.md` — two-project setup, root dirs, env var tables, Neon steps, deploy order.

### E. Verification

- [ ] Build libs + `next build` for demo (file backend, no DATABASE_URL) → passes.
- [ ] Demo `tsc --noEmit` clean (Postgres path typechecks).
- [ ] Facilitator typecheck/build clean.
- [ ] Prettier clean on touched files.

## Review section (done 2026-06-14)

All items complete. Verified green:

- `pnpm --filter @reineira-os/x402-rss-demo^... run build` → shared/core/x402-rss dist built.
- demo `tsc --noEmit` → clean (Postgres path typechecks against `@neondatabase/serverless` v1.1).
- demo `next build` → success; all 12 API routes render dynamic (`ƒ`), not statically prerendered.
- facilitator `tsc --noEmit` + `tsup` build → clean.
- prettier → clean on all touched files.
- secrets check: `.env.local` + both `.json` stores remain gitignored; no 64-hex keys in new docs/code.

Design note: stores keep identical business logic; only `readStore`/`writeStore`/`withLock` swap
to `createDocStore`. Backend auto-selects (file locally, Postgres on Vercel). Cross-instance writes
are last-write-wins — fine for the testnet demo's sequential flow; documented in `docStore.ts`.

Not done by design (user chose "prepare only"): no `vercel link`, no project creation, no env
entry, no actual deploy. Steps for that are in `DEPLOY.md`.
