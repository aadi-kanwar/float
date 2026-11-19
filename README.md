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
- **Phase 3 (money engine):** draws (ask → approve → mark sent), "I've
  paid" and admin confirmation, monthly statements (last day, 23:59 IST),
  daily late fees after the deadline (cap, safe to run twice), deposit
  settlement, waivers, reversals, terms acceptance, in-app notifications,
  admin overview and queues. See "Money rules" below.

- **Charts and calendar:** resident credit meter, deadline bar, deposit
  meter; admin credit across residents, statement statuses, money in/out,
  and a month calendar of money events. Chart colours (`--chart-*` in
  `src/app/globals.css`) are Float-only tokens checked for colour-blind
  separation; every colour comes with a label or icon.
- **Phase 4 (points):** earn rules (base, early, streak; editable, can be
  switched off and reordered), points ledger, 12-month expiry (soonest
  first; only unused points expire), manual give/take, limit growth rules
  (off by default), points name everywhere from Settings.

- **Phase 5 (Perk Store):** perk editor (title, texts, icon or uploaded
  image, category, cost, stock, per-resident limit per month / semester
  (Jan–Jun, Jul–Dec) / total, dates, visibility, questions, fulfilment
  note, order), categories, store with category filter, redeem flow,
  live status timelines, admin redemptions queue with filters and a badge,
  refunds on reject/cancel, CSV export (ledger, statements, points,
  redemptions) for a date range.

## Points rules (as built)

- Earned only on principal repaid, for a statement paid in full by its
  deadline, once per statement; given when the admin confirms the payment
  that completes it (or when the statement is made, for early payment).
- Early and streak multipliers multiply together; the highest streak reached
  applies. A late statement earns 0 and resets the streak. Statements with
  only older dues carried over are skipped.
- If a payment is later reversed and the statement is no longer on time, its
  points are taken back.

## Money rules (as built)

- What anyone owes is never stored: `convex/lib/ledger.ts` replays the
  ledger. Corrections are reversing rows; nothing is edited or deleted.
- A draw counts against the limit from the moment it's asked, **fee
  included**, so a resident can never owe more than their limit (or deposit).
- A draw goes on the ledger (principal and fee as two rows) when the admin
  marks it sent. Money sent after a month's statement is made goes on the
  next month's statement.
- Payments clear the **oldest statement first**; within it late fees, then
  fees, then the amount drawn.
- A confirmed "I've paid" counts from when the resident said they paid. While
  one waits for the admin, late fees it would cover wait too; if the admin
  rejects it, the missed days are charged on the next run.
- New terms versions must be accepted again before the next draw.

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
