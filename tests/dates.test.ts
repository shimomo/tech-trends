import { expect, test } from "vitest";
import { daysBetween, jstDate, withinDays } from "../src/dates.js";

test("jstDate converts an instant to the JST calendar day", () => {
  expect(jstDate(new Date("2026-10-18T21:05:12Z"))).toBe("2026-10-19");
  expect(jstDate(new Date("2026-10-18T14:59:59Z"))).toBe("2026-10-18");
});

test("daysBetween counts JST calendar days from an ISO instant to a date", () => {
  expect(daysBetween("2026-10-16T20:54:20+09:00", "2026-10-19")).toBe(3);
  expect(daysBetween("2026-10-19T00:00:00+09:00", "2026-10-19")).toBe(0);
  expect(daysBetween("2026-10-20T00:00:00+09:00", "2026-10-19")).toBe(-1);
});

test("withinDays is inclusive of the boundary day", () => {
  expect(withinDays("2026-10-12T00:00:00+09:00", "2026-10-19", 7)).toBe(true);
  expect(withinDays("2026-10-11T23:59:59+09:00", "2026-10-19", 7)).toBe(false);
  expect(withinDays("2026-10-20T00:00:00+09:00", "2026-10-19", 7)).toBe(false);
});

test("an unparseable date is never within the window and does not throw", () => {
  expect(Number.isNaN(daysBetween("garbage", "2026-10-19"))).toBe(true);
  expect(withinDays("garbage", "2026-10-19", 7)).toBe(false);
  expect(withinDays("", "2026-10-19", 7)).toBe(false);
});
