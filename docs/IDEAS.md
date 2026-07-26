# Ideas

Post-v1. Nothing here is committed to, and nothing here is built.

`PRODUCT.md` is the product. This file is a holding pen for things that might
become product later. An idea earns a place here by being specific about what
it does and honest about what it costs. When one graduates, it moves into
`PRODUCT.md` and leaves this file.

---

## Year grid

One block per week of the calendar year, laid out like GitHub's contribution
graph.

The whole year is shown, including the weeks that have not happened yet, so
there are **four distinct states** rather than two:

| State | Meaning |
|---|---|
| Filled | A chapter exists for that week |
| Missed | The week passed with no chapter, after the user had started |
| Not yet | The week has not arrived |
| Before you started | The week is earlier than the user's first chapter |

Showing the weeks that remain is the point. The motivating part is looking at
the empty right-hand side of the year and seeing how much of it is still
available, not looking at the left-hand side and admiring a run.

### Only real gaps are gaps

**Before you started** is drawn as absent rather than as a gap — visually closer
to *not yet* than to *missed*, because neither of them means failure. One is
time that had not arrived, the other is time the user had not arrived for.
Neither is a week they declined to fill.

A July starter should not open the app to twenty-seven weeks of reproach for a
product they had never heard of. The grid begins where the user does.

**Only weeks between the first and the most recent chapter can be missed.** A
gap has to have something on both sides of it to be a gap at all; otherwise it
is just an edge. That gives *missed* a precise and narrow meaning — a week the
user was present for, and passed on — which is exactly the meaning that makes
the no-backfill rule honest rather than punitive.

One consequence worth naming: a user who stops posting accumulates no misses
while they are away, because there is no later chapter to close the gap. The
trailing weeks stay absent. If they come back, the weeks in between become
missed at that moment. That is the right way round — someone drifting away is
not shown a lengthening red streak, and someone returning gets an accurate
record rather than a flattering one.

### One grid per year, stacked

Years stack vertically, newest first, the way GitHub shows a profile's history.
2026 sits above 2025, and the page grows downwards as the archive does. You
scroll back through years rather than switching between them with a picker.

Only years that contain at least one chapter get a grid, plus the current year
always. There is no scrolling back through empty decades.

Only the current year has any **not yet** blocks, and only the user's first year
has any **before you started** blocks. Every year in between is the plain
two-state case. The top and bottom grids are the interesting ones and everything
between them is a straight record.

**Colour intensity comes from goals completed that week, not from whether a
post exists.** A week with a chapter and no completed goals is filled but pale.
A week with three completions is dark. This keeps the grid pointed at the thing
the product actually rewards — finishing — rather than at the act of posting.

### Explicitly no streak counter

`PRODUCT.md` lists "no streaks that punish you" as an anti-goal, and that rules
out the number, not the grid.

A grid is a record. You look at it and see what happened. A consecutive-week
count is a scoreboard: it converts the record into a single number that can be
lost, and losing it is the moment people quit. One missed week taking a 31 to a
0 is a punishment the product has no interest in delivering.

So: the grid renders, and nothing anywhere computes "current streak" or
"longest streak". If the grid ever ships, that constraint ships with it.

### Tension with no-backfill

This is the sharp edge, and it is deliberate.

`PRODUCT.md` says a missed week stays missed and the gap is honest. A grid
makes every gap permanent **and** visible at a glance, in a way scrolling
through history does not. A year with eleven misses will look like a year with
eleven misses, forever, and there will be no way to fix it.

That is the honest version of the feature and probably the right one, but it is
worth naming before building: the grid is the most confronting surface the
product would have, and it is confronting in exactly the way a streak counter
is not — it shows the truth rather than scoring it.

### Owner-only, permanently

**The grid is never shared and never disclosed, under any setting.** It renders
in the owner's own view and nowhere else. There is no connection, no link, no
opt-in and no future sharing tier that shows another person somebody's grid.

This is not a default to be relaxed later. Intensity by completions means the
grid encodes a per-week completed count for every week of the year, so a
shareable grid would disclose counts for entries the user specifically never
opted into disclosing — the per-entry privacy rule failing quietly rather than
loudly.

The consequence is worth stating plainly, because it is a benefit rather than a
restriction: **since the grid never crosses a privacy boundary, it can render
full completion detail.** It is not constrained to the shareable
`done / total` shape. It can show exactly what was completed and when, at
whatever fidelity is useful, because the only person who will ever see it
already knows all of it. The private surface gets to be the honest one.

### Settled

- **Block count comes from the ISO week-year, never a hardcoded 52.** 2026 has
  53 ISO weeks; 2025 has 52. `parseWeekId` in `server/week.ts` already knows
  which, so the count is derived and the layout has to survive the extra block
  rather than assume it away.
- **Calendar year, not a rolling window and not an anniversary year anchored to
  the user's start month.** A rolling window is out because every block in it is
  already decided — it has no not-yet-arrived weeks at all, which are the
  motivating part. An anniversary year was considered as a way to avoid
  charging a mid-year starter for the months before they arrived; the *before
  you started* state solves that directly and keeps the shared, legible
  "2026" label and the January boundary everyone already reads. Years stack, so
  nothing is lost each January; the previous year moves down the page rather
  than away.
- **Four states, not three.** *Before you started* covers every week earlier
  than the user's first chapter, drawn as absent. *Missed* is reserved for weeks
  between the first and the most recent chapter. Both edges of the record are
  therefore blank rather than red, and only the interior can show gaps.
- **Both boundaries are derived from the archive, not stored.** The first and
  most recent chapter are `MIN(week_id)` and `MAX(week_id)` over `entries`, in
  the same spirit as the completed count: derived at read time, nothing to keep
  in sync, nothing to go stale if the archive is rebuilt from disk. Note that
  ISO week ids sort correctly as strings, so this stays cheap.
