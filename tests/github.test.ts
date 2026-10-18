import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { Http } from "../src/http.js";
import { collectGithub } from "../src/sources/github.js";
import type { GithubConfig } from "../src/types.js";

const html = readFileSync("tests/fixtures/trending-typescript.html", "utf8");

const cfg: GithubConfig = {
  trendingLists: ["", "typescript", "javascript", "python"],
  languages: ["TypeScript"],
  topics: [],
  keywords: [],
  maxItems: 10,
  hotThreshold: 500,
  newWithinDays: 7,
};

type Handler = (url: string, calls: number) => Response;

function repoJson(
  fullName: string,
  extra: Record<string, unknown> = {},
): Response {
  const [owner, name] = fullName.split("/");
  return Response.json({
    full_name: fullName,
    html_url: `https://github.com/${fullName}`,
    description: `desc of ${name}`,
    language: "TypeScript",
    stargazers_count: 1234,
    created_at: "2026-10-15T00:00:00Z",
    topics: ["agents"],
    owner: { login: owner },
    ...extra,
  });
}

/** URL ごとの呼び出し回数を数えつつ、ハンドラで応答を決める fetch スタブ */
function stubHttp(
  overrides: Record<string, Handler> = {},
): Http & { calls: Record<string, number>; sleeps: number[] } {
  const calls: Record<string, number> = {};
  const sleeps: number[] = [];
  return {
    calls,
    sleeps,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    fetch: async (input) => {
      const url = String(input);
      calls[url] = (calls[url] ?? 0) + 1;
      const override = overrides[url];
      if (override) return override(url, calls[url]);
      if (url.startsWith("https://github.com/trending"))
        return new Response(html, { status: 200 });
      const m = url.match(/^https:\/\/api\.github\.com\/repos\/(.+)$/);
      if (m?.[1]) return repoJson(m[1]);
      return new Response("not found", { status: 404 });
    },
  };
}

test("collectGithub merges lists, enriches and reports no errors", async () => {
  const http = stubHttp();
  const { candidates, errors } = await collectGithub(cfg, http, "token");
  expect(errors).toEqual([]);
  expect(candidates).toHaveLength(5);
  const first = candidates.find((c) => c.fullName === "anomalyco/opencode");
  expect(first).toMatchObject({
    url: "https://github.com/anomalyco/opencode",
    topics: ["agents"],
    createdAt: "2026-10-15T00:00:00Z",
    enriched: true,
    starsToday: 1417,
    stars: 1234,
  });
  expect(http.calls["https://github.com/trending?since=daily"]).toBe(1);
  expect(http.calls["https://github.com/trending/typescript?since=daily"]).toBe(
    1,
  );
});

test("a list that fails twice is recorded and the others continue", async () => {
  const http = stubHttp({
    "https://github.com/trending/typescript?since=daily": () =>
      new Response("boom", { status: 500 }),
  });
  const { candidates, errors } = await collectGithub(cfg, http, "token");
  expect(errors).toEqual([
    {
      source: "github",
      scope: "list:typescript",
      message: expect.stringContaining("500"),
    },
  ]);
  expect(candidates).toHaveLength(5);
  expect(http.calls["https://github.com/trending/typescript?since=daily"]).toBe(
    2,
  );
});

test("a list with zero rows is treated as a failure", async () => {
  const http = stubHttp({
    "https://github.com/trending/python?since=daily": () =>
      new Response("<html></html>", { status: 200 }),
  });
  const { errors } = await collectGithub(cfg, http, "token");
  expect(errors).toEqual([
    {
      source: "github",
      scope: "list:python",
      message: expect.stringContaining("0 rows"),
    },
  ]);
});

test("404 on enrichment drops the candidate silently", async () => {
  const http = stubHttp({
    "https://api.github.com/repos/cursor/plugins": () =>
      new Response("", { status: 404 }),
  });
  const { candidates, errors } = await collectGithub(cfg, http, "token");
  expect(errors).toEqual([]);
  expect(candidates).toHaveLength(4);
  expect(candidates.some((c) => c.fullName === "cursor/plugins")).toBe(false);
});

test("rate limit with retry-after is retried, not dropped", async () => {
  const http = stubHttp({
    "https://api.github.com/repos/anomalyco/opencode": (_url, n) =>
      n === 1
        ? new Response("", { status: 403, headers: { "retry-after": "1" } })
        : repoJson("anomalyco/opencode"),
  });
  const { candidates, errors } = await collectGithub(cfg, http, "token");
  expect(errors).toEqual([]);
  expect(
    candidates.find((c) => c.fullName === "anomalyco/opencode")?.enriched,
  ).toBe(true);
  expect(http.sleeps).toContain(1000);
});

test("enrichment failure after retries keeps the candidate unenriched", async () => {
  const http = stubHttp({
    "https://api.github.com/repos/ruvnet/ruflo": () =>
      new Response("", { status: 500 }),
  });
  const { candidates, errors } = await collectGithub(cfg, http, "token");
  expect(errors).toEqual([
    {
      source: "github",
      scope: "repo:ruvnet/ruflo",
      message: expect.stringContaining("500"),
    },
  ]);
  const c = candidates.find((c) => c.fullName === "ruvnet/ruflo");
  expect(c).toMatchObject({
    enriched: false,
    topics: [],
    createdAt: null,
    stars: 76290,
    starsToday: 502,
  });
  expect(http.calls["https://api.github.com/repos/ruvnet/ruflo"]).toBe(4);
});

test("sends the bearer token to the api", async () => {
  let auth: string | null = null;
  const http = stubHttp();
  const inner = http.fetch;
  http.fetch = async (input, init) => {
    if (String(input).startsWith("https://api.github.com/"))
      auth = new Headers(init?.headers).get("authorization");
    return inner(input, init);
  };
  await collectGithub(cfg, http, "secret");
  expect(auth).toBe("Bearer secret");
});
