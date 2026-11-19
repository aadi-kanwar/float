# Float (by Livoza)

Deposit-backed pocket money for PG residents. A resident draws small
amounts against their security deposit, repays by a monthly deadline, pays
a small fee, and earns points for repaying on time. Points are spent in a
Perk Store run by the admin.

Built on the same stack, tooling and design system as **Dine** (MealSync)
and **Crate**: Next.js 16, Convex (database, functions, auth) on **its own
Convex project**, Tailwind 4 with Dine's tokens and components (copied
verbatim), Vitest + convex-test. Every date rule uses India time
(Asia/Kolkata); money is stored as whole paise.

## Roles

| Role | Can do |
| --- | --- |
| **Admin** | Everything: residents, money, points, perks, settings, audit log. |
| **Resident** | Only their own data. |

There are no other roles. The Livoza Hub's Warden/Manager and Staff types get
no access to Float.

## Signing in

- **Livoza Hub** (the normal way): admins and residents open Float from the
  hub, already signed in (12-hour login). Residents are created here
  automatically by the hub; the admin then sets their deposit and limit.
- **Float's own login** (backup until `HUB_ONLY=true`): mobile number
  (+91 by default) + password. No sign-up: an admin adds a resident with a
  temporary password they must change at first sign-in. 5 wrong passwords
  lock that number for 15 minutes. Only an admin resets passwords.
- Every permission is checked in the backend (`convex/lib/functions.ts`),
  not just on screen. A resident can never read or change anyone else's data.

## Built so far

- **Phase 2 (foundation):** design system, sign-in, roles, residents
  (add, edit, deposit, limit, pause/resume, reset password), PGs, Settings
  (versioned, every change audit-logged), audit log, first-admin seed,
  deploy-key wiring.

## Deploy key

Float's Convex deploy key lives only in the environment variable
`FLOAT_CONVEX_DEPLOY_KEY`. The Convex CLI reads `CONVEX_DEPLOY_KEY`, so the
scripts map it for one command at a time and ignore any other app's key:

```bash
npm run convex -- deploy                    # scripts/float-convex.mjs
npm run convex -- env set HUB_ORIGIN https://admin.livoza.org
npm run seed                                # first admin from SEED_ADMIN_*
```

The Vercel build (`npm run vercel-build`, `scripts/vercel-build.mjs`) does the
same with `FLOAT_CONVEX_DEPLOY_KEY` set in Vercel. The key is never printed,
logged or committed.

## First admin

Set `SEED_ADMIN_NAME`, `SEED_ADMIN_PHONE` and `SEED_ADMIN_PASSWORD` on Float's
Convex deployment. The Vercel build creates the admin from them (or run
`npm run seed`). It works once only. Remove `SEED_ADMIN_PASSWORD` afterwards.

## Commands

```bash
npm run dev           # website
npm run dev:backend   # Convex backend (uses FLOAT_CONVEX_DEPLOY_KEY)
npm run lint
npm run typecheck
npm test              # backend tests (no deployment needed)
npm run codegen:offline
```
