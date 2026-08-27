/** Self-check for the streak maths. Run it with: node lib/day.check.ts
 *
 * Date arithmetic is where off-by-one bugs live, and a streak that resets
 * wrongly is the single most-complained-about bug in every tracker app that
 * has one. Excluded from tsconfig so `next build` ignores the .ts import.
 */
import {
  addDays,
  dayLabel,
  lastSevenDays,
  localDate,
  longestStreak,
  streakFrom,
} from "./day.ts";
import assert from "node:assert/strict";

const today = "2026-08-27";

assert.equal(addDays(today, -1), "2026-08-26");
assert.equal(addDays(today, 1), "2026-08-28");
assert.equal(addDays("2026-03-01", -1), "2026-02-28", "leap-free February");
assert.equal(addDays("2026-01-01", -1), "2025-12-31", "year boundary");

assert.equal(streakFrom([], today), 0);
assert.equal(streakFrom([today], today), 1, "logged today counts");
assert.equal(
  streakFrom(["2026-08-26", "2026-08-25"], today),
  2,
  "today not logged yet: the streak still stands at yesterday's count"
);
assert.equal(
  streakFrom(["2026-08-27", "2026-08-26", "2026-08-24"], today),
  2,
  "a missed day ends the run"
);
assert.equal(
  streakFrom(["2026-08-25", "2026-08-24"], today),
  0,
  "two days missed: the streak is genuinely over"
);
assert.equal(streakFrom(["2026-08-27", "2026-08-27"], today), 1, "duplicates don't double-count");

assert.equal(longestStreak([]), 0);
assert.equal(longestStreak(["2026-08-27"]), 1);
assert.equal(
  longestStreak(["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-10", "2026-08-11"]),
  3,
  "the best run wins, not the most recent one"
);
assert.equal(
  longestStreak(["2026-07-30", "2026-07-31", "2026-08-01"]),
  3,
  "a run crossing a month boundary is still one run"
);

const week = lastSevenDays(["2026-08-27", "2026-08-22"], today);
assert.equal(week.length, 7);
assert.equal(week[0].iso, "2026-08-21", "oldest first");
assert.equal(week[6].iso, today);
assert.equal(week[6].isToday, true);
assert.deepEqual(
  week.map((d) => d.logged),
  [false, true, false, false, false, false, true]
);

assert.equal(dayLabel(today, today), "Today");
assert.equal(dayLabel("2026-08-26", today), "Yesterday");
assert.match(dayLabel("2026-08-20", today), /Aug/);

assert.equal(localDate(new Date(2026, 7, 3)), "2026-08-03", "single digits are padded");

console.log("day.ts: all checks passed");
