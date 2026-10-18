import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseTrending } from "../src/sources/trending.js";

const rows = parseTrending(
  readFileSync("tests/fixtures/trending-typescript.html", "utf8"),
);

test("parses every Box-row", () => {
  expect(rows).toHaveLength(5);
});

test("reads name, description, language, stars and stars today", () => {
  expect(rows[0]).toEqual({
    fullName: "anomalyco/opencode",
    description: "The open source coding agent.",
    language: "TypeScript",
    stars: 215922,
    starsToday: 1417,
  });
});

test("a row without language or stars today yields null and 0", () => {
  expect(rows[4]).toMatchObject({
    fullName: "example/nolang",
    language: null,
    starsToday: 0,
  });
});

test("returns [] for html without rows", () => {
  expect(parseTrending("<html></html>")).toEqual([]);
});
