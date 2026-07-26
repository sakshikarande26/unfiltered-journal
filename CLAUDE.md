# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

Read `docs/PRODUCT.md` first. This file is how, that file is why.

## Stack

- Vite + React + TypeScript
- Local Node server (Fastify), SQLite via better-sqlite3
- Photos on disk under `data/entries/<week_id>/`, never in the database
- No cloud services, no auth, no network calls except the AI vision call

## Commands

- `npm test` - vitest
- `npx vitest run backend/week.test.ts` - a single test file
- `npm run typecheck` - tsc, no emit
- `npm run db:reset` - drop and rebuild the index from disk

`npm run dev` does not exist yet. There is no server and no client - only the
data layer. Add it with the first route.

## Entry lifecycle

An entry (a "chapter" in the UI) moves Empty -> Draft -> Published -> Locked.
The transitions are driven by the clock, not by user action:

- The draft opens Monday 12:00am and accumulates edits all week.
- Publishing commits the entry but leaves it editable until the week ends.
- Sunday 11:59pm locks it permanently. Nothing unlocks it.
- No backfilling. A past week with no entry stays empty forever.

Anything that writes entry content must check the lock state on the server. Do
not rely on the client hiding the edit affordance.

### Content freezes, state does not

Every field belongs to one of two categories, and the distinction decides
whether the lock applies:

**Content** — what happened that week. Title, description, liked, challenging,
photos, photo descriptions, goal text, goal photos. Content freezes and never
thaws. A write to content on a locked entry is rejected.

**State** — how you relate to that week now. Goal completion, pinned, archived,
goalsDisclosed. State stays writable forever, on any entry, however old. These
writes must never consult the entry lock.

The test for a new field: does it record what happened, or what you think about
it now? The first is content and freezes; the second is state and does not.

Note the two content freeze points are different. Goal text and goal photos
freeze at **publish**, which can happen any day. The rest of the content stays
editable until the week ends and freezes at **Sunday 11:59pm**. A published
Wednesday entry has frozen goals and an editable title. Do not collapse these
into one check.

## Hard rules

- Entry content is immutable once locked. No update or delete route exists for
  it. Entry state stays writable - see "Content freezes, state does not".
- One entry per week. Enforced with a UNIQUE constraint on `week_id`.
- Week ids are ISO weeks in the user's local timezone. Never store a bare date
  and derive the week at read time.
- No AI-generated journal text. Photo descriptions only.
- Max 5 photos and max 5 goals per entry, enforced server-side. First photo is
  the cover.

### Goals

- No update or delete route for goal text or goal photos after publish. Goals
  are writable only while the entry is a draft. No grace window - the freeze is
  at the publish transaction, not publish plus a timer.
- **Goal completion is state, not content.** Completion toggles must never
  consult the entry lock, at any age. Every write to goal text or goal photos
  must.
- Goal text and goal photos are never returned by any endpoint that represents
  a shared view. There is no flag, setting, or query parameter that opts into
  returning them.
- Never expose unfinished goals, including their count, as a discrete field.
- Shareable shape is the completed count, the total, and which goals are ticked
  - nothing that identifies an unfinished goal.
- The completed count is derived (`done / total`) at read time, never stored.
- Disclosure is opt-in per entry and only offerable once `done >= 1`. An entry
  with zero completions has no disclosure state to set.
- Un-completing the last completed goal turns disclosure off. A disclosed entry
  showing `0/n` is a state disclosure is never offered for, so it must not be
  reachable by undoing a completion either.

## Conventions

- Filesystem is the source of truth, SQLite is a rebuildable index.
- Server owns all date and week logic. The client never computes a week id.
- Types live in `shared/types.ts` and are imported by both sides.
- Tests for week boundary logic are required. Cover Sunday 11:59pm, Monday
  12:00am, and a timezone change.

## Working agreement

- Use plan mode for anything touching the schema, the week logic, or routes.
- Do not claim tests pass without running them and showing the output.
- When there is a real choice, state the alternatives and why you picked one.
- Small commits, one feature each.