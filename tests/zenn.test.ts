import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { Http } from "../src/http.js";
import { collectZenn, fetchZennTopic } from "../src/sources/zenn.js";
import type { ZennConfig } from "../src/types.js";

const fixture = readFileSync("tests/fixtures/zenn-llm-daily.json", "utf8");

const cfg: ZennConfig = {
  topics: ["llm", "ai"],
  pagesPerTopic: 2,
  windowDays: 7,
  minLikes: 10,
  maxItems: 10,
  hotThreshold: 50,
  newWithinDays: 2,
};

type Handler = (url: URL, calls: number) => Response;

function stubHttp(
  handler: Handler = () => new Response(fixture),
): Http & { urls: string[] } {
  const urls: string[] = [];
  const counts: Record<string, number> = {};
  return {
    urls,
    sleep: async () => {},
    fetch: async (input) => {
      const url = new URL(String(input));
      urls.push(url.toString());
      counts[url.toString()] = (counts[url.toString()] ?? 0) + 1;
      return handler(url, counts[url.toString()] ?? 1);
    },
  };
}

test("fetchZennTopic maps the api shape", async () => {
  const http = stubHttp();
  const articles = await fetchZennTopic("llm", 1, http);
  expect(articles).toHaveLength(5);
  expect(articles[0]).toEqual({
    id: 663665,
    title: expect.stringContaining("階層ナビゲーション型RAG"),
    url: "https://zenn.dev/aiforall/articles/8e1803396534de",
    likedCount: 22,
    publishedAt: "2026-10-16T11:30:05.084+09:00",
    username: "aifnishina",
    name: expect.any(String),
    emoji: "🌲",
    topics: ["llm"],
  });
  expect(http.urls[0]).toBe(
    "https://zenn.dev/api/articles?topicname=llm&order=daily&count=48&page=1",
  );
});

test("fetchZennTopic requests the configured number of pages", async () => {
  const http = stubHttp();
  await fetchZennTopic("llm", 2, http);
  expect(http.urls).toHaveLength(2);
  expect(http.urls[1]).toContain("page=2");
});

test("fetchZennTopic stops when next_page is null", async () => {
  const lastPage = JSON.stringify({ ...JSON.parse(fixture), next_page: null });
  const http = stubHttp(() => new Response(lastPage));
  await fetchZennTopic("llm", 3, http);
  expect(http.urls).toHaveLength(1);
});

test("fetchZennTopic throws on http errors", async () => {
  const http = stubHttp(() => new Response("", { status: 503 }));
  await expect(fetchZennTopic("llm", 1, http)).rejects.toThrow(
    /^HTTP 503 fetching zenn topic "llm" page 1$/,
  );
});

const rateLimitedPage = `<!DOCTYPE html>
<html><head><title>Access denied</title><style>body { color: red; }</style></head>
<body><h1>Error 1015</h1>
<p>You are   being rate limited</p></body></html>`;

function rateLimited(): Response {
  return new Response(rateLimitedPage, {
    status: 429,
    headers: { "retry-after": "60", "cf-ray": "a5ed34453e535a27-NRT" },
  });
}

test("an http error keeps retry-after, cf-ray and the start of the body", async () => {
  const http = stubHttp(rateLimited);
  const error = await fetchZennTopic("llm", 1, http).catch((e: Error) => e);
  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message;
  expect(message).toContain('HTTP 429 fetching zenn topic "llm" page 1');
  expect(message).toContain("retry-after=60");
  expect(message).toContain("cf-ray=a5ed34453e535a27-NRT");
  expect(message).toContain(
    "Access denied Error 1015 You are being rate limited",
  );
  expect(message).not.toContain("<");
  expect(message).not.toContain("color: red");
});

test("a long error body is cut short", async () => {
  const http = stubHttp(() => new Response("x".repeat(5000), { status: 500 }));
  const error = await fetchZennTopic("llm", 1, http).catch((e: Error) => e);
  const message = (error as Error).message;
  expect(message).toContain("xxxxxxxxxx");
  expect(message.length).toBeLessThan(300);
});

test("a topic still rate limited after its retry stops the remaining topics", async () => {
  const http = stubHttp(rateLimited);
  const { candidates, errors } = await collectZenn(
    { ...cfg, topics: ["llm", "ai", "react"] },
    http,
    "2026-10-19",
  );
  expect(candidates).toEqual([]);
  expect(http.urls).toEqual([
    "https://zenn.dev/api/articles?topicname=llm&order=daily&count=48&page=1",
    "https://zenn.dev/api/articles?topicname=llm&order=daily&count=48&page=1",
  ]);
  expect(errors).toEqual([
    {
      source: "zenn",
      scope: "topic:llm",
      message: expect.stringContaining("HTTP 429"),
    },
    {
      source: "zenn",
      scope: "topics",
      message: expect.stringContaining("ai, react"),
    },
  ]);
});

test("a rate limit on a later topic keeps what was already fetched", async () => {
  const http = stubHttp((url) =>
    url.searchParams.get("topicname") === "ai"
      ? rateLimited()
      : new Response(fixture),
  );
  const { candidates, errors } = await collectZenn(
    { ...cfg, topics: ["llm", "ai", "react"] },
    http,
    "2026-10-19",
  );
  expect(candidates.length).toBeGreaterThan(0);
  expect(http.urls.some((u) => u.includes("topicname=react"))).toBe(false);
  expect(errors.map((e) => e.scope)).toEqual(["topic:ai", "topics"]);
});

test("a rate limit on the last topic records only that topic", async () => {
  const http = stubHttp(rateLimited);
  const { errors } = await collectZenn(
    { ...cfg, topics: ["llm"] },
    http,
    "2026-10-19",
  );
  expect(errors.map((e) => e.scope)).toEqual(["topic:llm"]);
});

test("a rate limit that clears on retry does not stop the run", async () => {
  let first = true;
  const http = stubHttp(() => {
    if (first) {
      first = false;
      return rateLimited();
    }
    return new Response(fixture);
  });
  const { errors } = await collectZenn(
    { ...cfg, topics: ["llm", "ai"] },
    http,
    "2026-10-19",
  );
  expect(errors).toEqual([]);
  expect(http.urls.some((u) => u.includes("topicname=ai"))).toBe(true);
});

test("a failure other than 429 does not stop the remaining topics", async () => {
  const http = stubHttp((url) =>
    url.searchParams.get("topicname") === "ai"
      ? new Response("", { status: 503 })
      : new Response(fixture),
  );
  const { candidates, errors } = await collectZenn(
    { ...cfg, topics: ["ai", "llm"] },
    http,
    "2026-10-19",
  );
  expect(errors.map((e) => e.scope)).toEqual(["topic:ai"]);
  expect(candidates.length).toBeGreaterThan(0);
});

test("collectZenn merges the same article from two topics with topics unioned", async () => {
  const http = stubHttp();
  const { candidates, errors } = await collectZenn(cfg, http, "2026-10-19");
  expect(errors).toEqual([]);
  const hits = candidates.filter((c) => c.id === 663665);
  expect(hits).toHaveLength(1);
  expect(hits[0]?.topics).toEqual(["llm", "ai"]);
});

test("collectZenn drops articles outside windowDays", async () => {
  const http = stubHttp();
  const { candidates } = await collectZenn(cfg, http, "2026-10-25");
  const ids = candidates.map((c) => c.id);
  expect(ids).toContain(671041); // 2026-10-18 公開
  expect(ids).not.toContain(663665); // 2026-10-16 公開
});

test("a failing topic is retried once then recorded", async () => {
  const http = stubHttp((url) =>
    url.searchParams.get("topicname") === "ai"
      ? new Response("", { status: 503 })
      : new Response(fixture),
  );
  const { candidates, errors } = await collectZenn(cfg, http, "2026-10-19");
  expect(errors).toEqual([
    {
      source: "zenn",
      scope: "topic:ai",
      message: expect.stringContaining("503"),
    },
  ]);
  expect(candidates.length).toBeGreaterThan(0);
  expect(
    http.urls.filter(
      (u) => u.includes("topicname=ai&") && u.includes("page=1"),
    ),
  ).toHaveLength(2);
});

test("topic names are url-encoded", async () => {
  const http = stubHttp();
  await collectZenn({ ...cfg, topics: ["生成ai"] }, http, "2026-10-19");
  expect(http.urls[0]).toContain(`topicname=${encodeURIComponent("生成ai")}`);
});

test("a topic that fails once is retried after a pause", async () => {
  const sleeps: number[] = [];
  let first = true;
  const http = stubHttp(() => {
    if (first) {
      first = false;
      return new Response("", { status: 503 });
    }
    return new Response(fixture);
  });
  http.sleep = async (ms) => {
    sleeps.push(ms);
  };
  const { errors } = await collectZenn(
    { ...cfg, topics: ["llm"] },
    http,
    "2026-10-19",
  );
  expect(errors).toEqual([]);
  expect(sleeps).toEqual([5000]);
});
