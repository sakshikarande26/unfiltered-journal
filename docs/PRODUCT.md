# the-unfiltered-journal

A weekly photo journal that turns your goals into proof.

You post once a week. Five photos, a short title, a line about what you liked
and what you found challenging. You can attach up to five private goals. When
you complete them, the count becomes public. The words never do.

No edits. No deletes. No algorithm.

---

## Why it exists

Social media rewards posting constantly and proving nothing, and rewards
scrolling most of all. This is the opposite. One post a week, and the only
thing anyone else ever learns about your goals is whether you actually did
them.

It should feel like a productive place to spend ten minutes on a Sunday, not a
place you lose an hour to. Success is a user who opens it once a week and
closes it feeling like they did something.

---

## The week rule

This is the core logic of the app. Get it exactly right.

- A week runs **Monday 12:00am to Sunday 11:59pm, local time**.
- Every entry is stamped with a **week id** (`2026-W30`), never a bare date.
- **One entry per week.** Enforced by a UNIQUE constraint on `week_id`, not by
  a check in the UI.
- You choose your own day. Posting Tuesday and posting Saturday both fill the
  same week. It is not a rolling seven days from your last post.
- The week is an **open draft from Monday**. Add photos and text as the week
  happens, then publish once. This is deliberate: nobody writes a good entry
  from a blank page on Sunday night.
- After Sunday 11:59pm the entry **locks permanently**.
- **No backfilling.** A missed week stays missed. The gap is honest.

### States

| State | Meaning |
|---|---|
| Empty | No draft started for the current week |
| Draft | Open, editable, accumulating photos and text |
| Published | Committed this week, still editable until the week ends |
| Locked | Past week, permanently read only |

---

## Entries

An entry is called a **chapter** in the interface.

Contents:
- **Title** — short
- **Description** — one or two lines, not a paragraph
- **Photos** — up to 5, ordered, first one is the cover
- **One thing I liked** — freeform
- **One thing I found challenging** — freeform, deliberately not called "bad"
- **Goals** — up to 5, optional

Rules:
- Entries can **never be edited or deleted** once locked.
- Entries can be **pinned** and **archived**. Archiving hides from the main
  history, it does not delete.
- Posting is **low stress and optional**. A perfectly valid entry is one photo
  and a sentence about something you liked. Goals are not required.

---

## Goals

Up to **5 per entry**, always optional. Each goal has text, and optionally a
photo of the goal.

### Why goals work this way

Other platforms reward announcing a goal, which is why announced goals so often
never get done. The announcement is the payout, so the work becomes optional.
Here the only payout is finishing. The denominator stays honest about the
misses, and the hidden text keeps those misses private.

### How goals freeze

- Goals are written **while the entry is a draft**.
- They **freeze permanently at publish**. No edits, no additions, no removals
  afterwards. **No grace window.**
- This is a different moment from the entry lock. Publishing can happen any day
  of the week; the rest of the entry stays editable until Sunday 11:59pm.

### How completion works

- **Completing a goal is not an edit.** The entry lock must never block it.
- Goals belong to the week they were set in, but stay **completable forever**.
  Coming back a year later to finish something is the point, not an edge case.
- The count is **derived** (`done / total`) at read time, **never stored**.

### Privacy and disclosure

- **Goal text and goal photos are private permanently.** No setting discloses
  them. There is no view, no export, and no future sharing tier that reveals
  them.
- **Unfinished goals are never exposed**, including their count.
- Only the **completed count and total** can be shared, shown as `3/5` with
  ticks against the completed ones.
- Disclosure is **opt-in per entry**, and only becomes available once at least
  one goal in that entry is completed. The user may never disclose at all, and
  that is a normal outcome rather than an incomplete setup.

---

## Profile

Single local user for now.

- **Identity block**: name, one-line bio, and a few short "currently" fields
  (currently reading, currently into, where you are).
- **History**: every chapter below, newest first.
- Presented as a **story you scroll through**, not a feed you consume.

---

## Layout and feel

The UI is the product here. Explicit direction:

- Chapters appear as a **stack of photos layered on top of each other**, with
  the user's chosen cover photo on top. Not an Instagram grid. Not a TikTok
  full-bleed video wall.
- Each card shows the **cover photo, title, and a very short description**.
  Nothing else.
- Scrolling is continuous, but it reads as **chapters in a book**, not as an
  endless feed. Pacing over density.
- Tap a chapter to open it: photos large, the writing below, read only.
- The composer feels like a **whiteboard** — a space to think on, with the two
  sections (liked, challenging) laid out as areas rather than form fields.
- Physical over digital: slight rotation on photos, real paper feeling, a
  display font for titles and a clean sans for body. Two fonts maximum.
- **Publishing is a moment.** It happens once a week and should feel like it.

Anti-goals: no like counts, no comments, no streaks that punish you, no
notifications designed to pull you back in.

---

## AI

Exactly **one AI feature in v1**: photo descriptions generated on upload,
stored with the photo, and editable by the user.

This is the only place AI earns its place, because it adds information the user
did not write. It makes the archive searchable later by what things looked
like, not just by what got typed.

**The AI never writes journal text.** Not the title, not the description, not
the liked or challenging sections, not the goals. Those are the user's words or
they are worthless. This constraint is a product decision, not a limitation.

---

## Sharing (deferred, but design for it)

Not built in v1. Documented so the schema does not have to be rewritten later.

- No public search, no discovery, no "people you may know".
- You **copy a link to your profile** and send it to whoever you want.
- Connections are deliberate and mutual, not open following.
- Connections can see your chapters and your **goal counts**. Never goal text,
  never unfinished goals.
- You control who sees what.

---

## Out of scope for v1

- Accounts, login, any server-side user
- Followers, sharing, profile URLs
- Search over entries
- Export
- Notifications
- Mobile app

---

## Technical shape

- Local-first web app. Runs on your machine, no cloud.
- **Filesystem is the source of truth**: one folder per week under
  `data/entries/<week_id>/` holding the photos and the text.
- SQLite is a **rebuildable index**, not the source of truth. Deleting it and
  reindexing from disk must always work.
- Photos live on disk as files. Paths in the database, never blobs.
- Thumbnails generated once on upload and cached.
- All week and date logic lives on the server. The client never computes a
  week id.