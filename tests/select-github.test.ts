import { expect, test } from "vitest";
import { matchesInterest, selectGithub } from "../src/select/github.js";
import type { GithubCandidate } from "../src/sources/github.js";
import type { GithubConfig } from "../src/types.js";

const cfg: GithubConfig = {
  trendingLists: [""],
  languages: ["TypeScript", "JavaScript"],
  topics: ["llm", "react"],
  keywords: ["\\b(ai|llm|agents?)\\b"],
  maxItems: 10,
  hotThreshold: 500,
  newWithinDays: 7,
};

let seq = 0;
function cand(over: Partial<GithubCandidate> = {}): GithubCandidate {
  seq++;
  return {
    fullName: `owner/repo${seq}`,
    description: "A plain library",
    language: "Python",
    stars: 1000,
    starsToday: 100,
    url: `https://github.com/owner/repo${seq}`,
    topics: [],
    createdAt: "2026-01-01T00:00:00Z",
    enriched: true,
    ...over,
  };
}

test("matches by language, topic or keyword, and rejects the rest", () => {
  expect(matchesInterest(cand({ language: "TypeScript" }), cfg)).toBe(true);
  expect(
    matchesInterest(cand({ language: "Python", topics: ["llm"] }), cfg),
  ).toBe(true);
  expect(
    matchesInterest(
      cand({ language: "Python", description: "An AI toolkit" }),
      cfg,
    ),
  ).toBe(true);
  expect(
    matchesInterest(
      cand({ language: "Python", fullName: "x/agents-sdk" }),
      cfg,
    ),
  ).toBe(true);
  expect(
    matchesInterest(
      cand({ language: "Python", description: "Numerical routines" }),
      cfg,
    ),
  ).toBe(false);
  expect(
    matchesInterest(cand({ language: null, description: null }), cfg),
  ).toBe(false);
});

test("ranks by stars today and caps at maxItems", () => {
  const cands = Array.from({ length: 12 }, (_, i) =>
    cand({ language: "TypeScript", starsToday: (i + 1) * 10 }),
  );
  const items = selectGithub(cands, cfg, "2026-10-19");
  expect(items).toHaveLength(10);
  expect(items.map((i) => i.delta)).toEqual([
    120, 110, 100, 90, 80, 70, 60, 50, 40, 30,
  ]);
});

test("ties on stars today are broken by total stars", () => {
  const a = cand({ language: "TypeScript", starsToday: 50, stars: 10 });
  const b = cand({ language: "TypeScript", starsToday: 50, stars: 20 });
  expect(selectGithub([a, b], cfg, "2026-10-19").map((i) => i.total)).toEqual([
    20, 10,
  ]);
});

test("hot and isNew follow the thresholds", () => {
  const items = selectGithub(
    [
      cand({
        language: "TypeScript",
        starsToday: 500,
        createdAt: "2026-10-12T00:00:00+09:00",
      }),
      cand({
        language: "TypeScript",
        starsToday: 499,
        createdAt: "2026-10-11T23:59:59+09:00",
      }),
      cand({ language: "TypeScript", starsToday: 10, createdAt: null }),
    ],
    cfg,
    "2026-10-19",
  );
  expect(items.map((i) => [i.hot, i.isNew])).toEqual([
    [true, true],
    [false, false],
    [false, false],
  ]);
});

test("maps candidate fields onto an Item", () => {
  const [item] = selectGithub(
    [
      cand({
        fullName: "openai/agents-sdk-ts",
        language: "TypeScript",
        description: "Build agents",
        stars: 2340,
        starsToday: 1900,
        topics: ["agents"],
        url: "https://github.com/openai/agents-sdk-ts",
        createdAt: "2026-10-15T09:00:00Z",
      }),
    ],
    cfg,
    "2026-10-19",
  );
  expect(item).toEqual({
    id: "github:openai/agents-sdk-ts",
    source: "github",
    title: "openai/agents-sdk-ts",
    url: "https://github.com/openai/agents-sdk-ts",
    description: "Build agents",
    language: "TypeScript",
    topics: ["agents"],
    total: 2340,
    delta: 1900,
    hot: true,
    isNew: true,
    publishedAt: "2026-10-15T09:00:00Z",
  });
});
