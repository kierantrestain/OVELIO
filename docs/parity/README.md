# OVELIO master plan: parity and beyond

**Goal.** One application that matches or beats Mautic for the master contact database, segmentation, lead scoring, forms and marketing automation; Listmonk for newsletters, delivery, bulk email and email statistics; and Umami for website tracking, traffic sources, events, funnels and conversion analytics. On top of that, it adds what none of them can do alone: one identity, one timeline and one consent record across email and web.

**How we get there.** Work from [backlog.md](backlog.md) (89 items with IDs, 11 confirmed bugs, 43 P0) in four parallel lanes plus a lead lane, as described below.

## 1. Where OVELIO stands (2026-11-22)

The research compared the exact engine versions OVELIO deploys (Mautic 7.2.2, Listmonk 6.2.0, Umami 3.5.0) with OVELIO `main` at `b7ed8d7`. Every claim cites file:line evidence:

| Report | Scope | Gap rows |
|---|---|---|
| [01](research/01-mautic-contacts-segments-scoring.md) | Contacts, custom fields, segments, scoring, stages, DNC, import, export, merge | 36 |
| [02](research/02-mautic-forms-automation.md) | Forms, campaign builder, scheduler, decisions, conditions, actions | 26 |
| [03](research/03-listmonk-campaigns-delivery.md) | Campaign pipeline, throughput, templates, tracking, bounces, stats | 29 |
| [04](research/04-umami-tracking-analytics.md) | Tracker, collection, sessions, filters, channels, funnels, attribution, revenue | 38 |

**Already strong:**
- Campaign lifecycle, scheduling and test sends.
- About 45 Umami read endpoints: realtime, sessions, goals, funnels, journeys, retention, revenue and web vitals.
- GDPR erase and export.
- A consent and suppression SMTP gateway with DNS diagnostics, which Listmonk lacks.
- A leased, generation-safe job queue.
- CI that proves restart persistence, client isolation and backup/restore.

**Confirmed bugs (fix first).** The lead session re-checked each against the code:
- **DEL-01:** one "Blocklist" click blocklists every bounced subscriber.
- **DEL-02:** newsletter personalisation is escaped, so recipients see the literal tag.
- **AUD-01:** point triggers are created with no events.
- **AUD-02:** custom field values are dropped.
- **ANA-01:** the analytics segment operator labels are wrong.
- **ANA-02:** the bot-filter variable in compose is never read.

The other five bugs in the backlog (AUT-01, DEL-03, DEL-04, ANA-03, ANA-04) are listed there, two of them marked as inferred until checked in the running stack.

**The biggest parity gaps:**
- Workflows are linear chains. There are no branches, no conditions and no "didn't act" path, so contacts can wait forever. OVELIO has 5 of Mautic's 26 actions.
- Segments have about 6 of Mautic's roughly 55 filter fields and 6 of its 24 operators, with no counts and no rebuild status.
- Forms have no submit actions and offer 5 of Mautic's 24 field types.
- No bounce source is wired. Throughput and tracking settings are stuck at engine defaults.
- Analytics filters are equality-only. There is no consent mode, no server-side events API and no identity stitching.

## 2. Decision D1: how native should OVELIO become?

**Decided 2026-11-22: option B, hybrid.** Phases 0 and 1 deepen the wrapper. Phase 2 builds the native identity and event store, delivery pipeline, and merge and dedupe.

OVELIO today is a console over three engines that each keep their own database. The research shows where that ceiling is:
- Listmonk sends at most once and can leave gaps after a crash; its retry flag is dead code. One global sliding window stalls every campaign at once. Campaigns can only target lists, so OVELIO mirrors segments into lists, on top of Mautic's cron delay.
- Mautic has no REST merge, and nothing recomputes segment membership when a contact changes.
- Identity stitching needs a store owned by OVELIO whichever path we choose.

| Option | What it means | Trade-off |
|---|---|---|
| A. Deepen the wrapper | Reach parity through the engine APIs only | Fastest to most P0 rows. Can't deliver merge, delivery guarantees, live segments or one timeline without side databases anyway. Runs 3 engines, MariaDB, 2 Postgres databases and cron |
| **B. Hybrid (recommended)** | Wrap for parity now (phases 0-1). Go native where wrapping can't deliver: **identity and a unified event store** (X-01 to X-06), **delivery pipeline** (DEL-20, which replaces Listmonk once it passes the DEL suite and also removes the AGPL component and the list mirroring), and **merge and dedupe** (AUD-11). Mautic stays the segment, form and automation engine; Umami stays the collector. Revisit native automation (AUT-21, AUD-19) after phase 2 | The fastest route to parity that also has a clear path to "better" |
| C. Full native rewrite | Rebuild all three engines inside OVELIO | Highest ceiling and one database, but rebuilding Mautic's campaign executioner, segment compiler and form processing (about 800 PHP files in scope) delays parity by months |

**Phases 0 and 1 are the same under every option**, so work can start before D1 is settled.

## 3. Lanes and file ownership

PLT-01 runs first and alone: it splits the 1,009-line gateway route, the contracts and the Mautic adapter. After that, each lane owns its own files, and four sessions can build in parallel without merge conflicts.

| Lane | Backlog | Owns (after PLT-01) |
|---|---|---|
| Lead | PLT, X, reviews, backlog status | `docs/parity/`, `compose*.yaml`, `deploy/`, `migrations/`, `scripts/worker.ts`, `src/server/{jobs,reporting,db,config}.ts`, `src/components/{shell,ui}.tsx`, the route registry |
| A: Audience | AUD | `src/server/mautic/{contacts,segments,points}.ts`, `src/server/audience.ts`, `src/server/routes/audience.ts`, `src/contracts/audience.ts`, `src/components/audience.tsx` |
| B: Automation and forms | AUT | `src/server/mautic/{campaigns,forms,content,workflows}.ts`, `src/server/routes/automations.ts`, `src/contracts/automations.ts`, `src/components/automations.tsx` |
| C: Delivery | DEL | `src/server/listmonk/`, `src/server/delivery.ts`, `scripts/smtp.ts`, `src/server/routes/campaigns.ts`, `src/contracts/campaigns.ts`, `src/components/{campaigns,bounces}.tsx`, `src/app/subscription/`, `src/app/api/delivery/` |
| D: Analytics | ANA | `src/server/umami/`, `src/server/routes/analytics.ts`, `src/contracts/analytics.ts`, `src/components/analytics.tsx`, `deploy/umami-init.mjs` |

Until it is moved into its own component, the bounce list still lives in `audience.tsx` (lane A). Lane C changes bounce behaviour on the server side only.

Changes a lane needs in a lead-owned file (Caddy routes, compose variables, a migration) go in a separate commit flagged `[shared]` in the PR. The lead merges those one at a time and numbers migrations at merge.

## 4. Phases

| Phase | Contents | Parallelism |
|---|---|---|
| 0. Foundation and fixes | PLT-01, then the 11 BUG items | PLT-01 alone, then 4 lanes |
| 1. P0 parity | The remaining P0 rows in AUD, AUT, DEL and ANA, plus X-03 (one consent record) | 4 lanes |
| 2. Cross-engine and native | X-01 identity, X-02 timeline, then the native modules chosen under D1 (DEL-20, AUD-11 and so on) | Lead plus the owning lanes |
| 3. Beyond parity | P1 rows, then P2 | 4 lanes |

## 5. How the agents work

- **Lead session:**
  - Owns backlog status, PLT-01 and the shared files.
  - Re-checks every BUG claim and every finding a lane reports before marking it.
  - Reviews and merges.
- **Lane sessions:**
  - One per lane, each in its own git worktree on a branch `lane/<a|b|c|d>-<topic>`.
  - Take items in order: BUG, then P0, then P1. One PR per 1-3 related items.
  - Before coding an item, read its research rows. For deeper engine behaviour, read the pinned source in `.refs/` (run `sh scripts/fetch-refs.sh`).
- **Models:** Sonnet for S and M items. Opus for the L design items: AUT-02 canvas, AUD-11 merge, DEL-20 delivery pipeline and X-01 identity.
- **Verification:**
  - Locally: `npm run lint && npm run typecheck && npm test && npm run build`.
  - Integration and browser suites need Docker and the Compose stack, so they run in CI on every push.
  - An item is `done` only when CI is green.
- **Saving usage:** the research reports already hold the engine mechanisms, so lanes don't re-research the engines or read other lanes' code. Reviews run `/code-review medium` on the PR diff.

**Definition of done for an item:**
- Its "done when" condition holds.
- At least one unit test is named with its ID.
- Lint, typecheck, unit tests and build pass.
- CI integration and e2e pass.
- The README's known limitations are updated if behaviour changed.
- The lead has set its status to `done`.

## 6. Ground rules

See [CLAUDE.md](../../CLAUDE.md). The most important one: **reimplement behaviour, never copy code** from Mautic (GPL-3.0-or-later) or Listmonk (AGPL-3.0-only). Umami code is MIT and may be adapted if its notice is kept in `NOTICE.md`.
