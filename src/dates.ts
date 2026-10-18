const jstFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** JST の暦日を YYYY-MM-DD で返す */
export function jstDate(now: Date): string {
  return jstFormatter.format(now);
}

function dayNumber(date: string): number {
  return (
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
    ) / 86_400_000
  );
}

/** fromIso の JST 暦日から toDate までの日数。同日 0、未来は負 */
export function daysBetween(fromIso: string, toDate: string): number {
  return dayNumber(toDate) - dayNumber(jstDate(new Date(fromIso)));
}

/** 0 <= daysBetween <= days */
export function withinDays(iso: string, today: string, days: number): boolean {
  const d = daysBetween(iso, today);
  return d >= 0 && d <= days;
}
