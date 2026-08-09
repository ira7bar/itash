# Feature ideas / open discussions

Not a roadmap — just discussions from past sessions worth picking back up,
kept here (tracked, unlike `dev/`/`debug/`) so they survive between sessions.

## Draft/pencil mode (raised 2026-08-09, deferred)

Idea: a Sudoku-style "draft mode" toggle — while active, typing into a cell
writes small candidate letters instead of committing one answer, and a cell
can hold multiple candidates at once. Motivated by "the unsure flag doesn't
work well."

Before building this, resolve the open question from that discussion: **what
specifically doesn't work about the existing "unsure" flag** (long-press to
toggle a word's dashed-underline marker, see `toggleUnsure` in `model.js`)?
Two different diagnoses point in different directions:

- If the *gesture* is the problem (long-press hard to trigger/discover on a
  phone) — that's a small, targeted interaction fix, not a reason for draft
  mode.
- If the *signal* is the problem (dashed underline too subtle to notice) —
  also a small, targeted visual fix.

Draft mode solves a genuinely different problem than "unsure" does —
candidate letters before committing to an answer, vs. flagging "I filled
this but I'm not confident" — so it's worth confirming draft mode is
actually the right fix before taking on its real cost:

- Touches the core typing model (`model.js` currently commits exactly one
  letter per cell, full stop) rather than being additive like chat was.
- Needs its own render treatment. Hebrew has ~22 letters vs. Sudoku's 9
  digits — cramming multiple candidates legibly into a cell already sized
  for one large letter (`.letter { font-size: clamp(10px, 3.6vw, 30px) }`)
  is a real design risk that digits-in-a-3x3-minigrid doesn't have to
  solve.
- Needs its own sync schema if it's meant to work in live rooms too
  (another per-cell child path, same pattern as `pushAnswerCell`).

Agreed: **build separately from chat**, not bundled into the same session/PR
— chat was purely additive (new sync path + reused identity/render
patterns); draft mode is a core-model change and deserves its own scoped
pass, after the "what's actually broken about unsure" question above is
answered.
