/** Calendar helpers, all in the user's own timezone.
 *
 * The server never guesses a timezone -- every date the app sends is the one
 * the user's phone is showing. `localDate()` used to be copy-pasted into four
 * screens; a single definition is one place for that rule to live.
 */

/** Today (or any Date) as YYYY-MM-DD, local. */
export function localDate(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Move an ISO day by N days. Parsed at noon so a daylight-saving shift can't
 *  push the result onto the day before. */
export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

/** "Today", "Yesterday", or "Mon, Aug 4". */
export function dayLabel(iso: string, today: string = localDate()): string {
  if (iso === today) return "Today";
  if (iso === addDays(today, -1)) return "Yesterday";
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** How many days in a row have something logged, counting back from today.
 *
 * A day with nothing logged *yet* doesn't break the streak -- it's only
 * broken once that day is over. Ending the count at yesterday means opening
 * the app at breakfast shows "5 days" and an invitation, not a zero and a
 * telling-off. Shame is a terrible retention mechanic and a worse feature in
 * a health app.
 */
export function streakFrom(loggedDays: Iterable<string>, today: string = localDate()): number {
  const days = loggedDays instanceof Set ? loggedDays : new Set(loggedDays);
  let cursor = days.has(today) ? today : addDays(today, -1);
  let streak = 0;

  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** The longest run of consecutive logged days anywhere in the set.
 *
 * Counted by only starting a run at a day whose predecessor is missing, so
 * each run is walked once rather than once per day inside it.
 */
export function longestStreak(loggedDays: Iterable<string>): number {
  const days = loggedDays instanceof Set ? loggedDays : new Set(loggedDays);
  let best = 0;

  for (const day of days) {
    if (days.has(addDays(day, -1))) continue; // mid-run: already counted
    let run = 0;
    let cursor = day;
    while (days.has(cursor)) {
      run += 1;
      cursor = addDays(cursor, 1);
    }
    best = Math.max(best, run);
  }
  return best;
}

/** The last seven days, oldest first, each flagged with whether it was logged.
 *  Feeds the row of dots that makes a streak visible instead of numeric. */
export function lastSevenDays(
  loggedDays: Iterable<string>,
  today: string = localDate()
): { iso: string; letter: string; logged: boolean; isToday: boolean }[] {
  const days = loggedDays instanceof Set ? loggedDays : new Set(loggedDays);
  return Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(today, i - 6);
    return {
      iso,
      letter: new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "narrow" }),
      logged: days.has(iso),
      isToday: iso === today,
    };
  });
}
