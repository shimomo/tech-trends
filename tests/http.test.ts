import { expect, test } from "vitest";
import { fetchWithRetry, type Http, mapLimit } from "../src/http.js";

function stubHttp(
  responses: Array<Response | Error>,
  sleeps: number[] = [],
): Http {
  return {
    fetch: async () => {
      const next = responses.shift();
      if (next === undefined) throw new Error("no more responses");
      if (next instanceof Error) throw next;
      return next;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  };
}

test("fetchWithRetry waits retry-after seconds then succeeds", async () => {
  const sleeps: number[] = [];
  const http = stubHttp(
    [
      new Response("", { status: 403, headers: { "retry-after": "3" } }),
      new Response("ok", { status: 200 }),
    ],
    sleeps,
  );
  const res = await fetchWithRetry(
    http,
    "u",
    {},
    { retries: 2, retryOn: (r) => r.status === 403 },
  );
  expect(res.status).toBe(200);
  expect(sleeps).toEqual([3000]);
});

test("fetchWithRetry backs off exponentially without retry-after", async () => {
  const sleeps: number[] = [];
  const http = stubHttp(
    [
      new Response("", { status: 503 }),
      new Response("", { status: 503 }),
      new Response("ok"),
    ],
    sleeps,
  );
  const res = await fetchWithRetry(
    http,
    "u",
    {},
    { retries: 2, retryOn: (r) => r.status >= 500 },
  );
  expect(res.status).toBe(200);
  expect(sleeps).toEqual([1000, 2000]);
});

test("fetchWithRetry gives up after retries and returns the last response", async () => {
  const http = stubHttp([
    new Response("", { status: 503 }),
    new Response("", { status: 503 }),
    new Response("", { status: 503 }),
  ]);
  const res = await fetchWithRetry(
    http,
    "u",
    {},
    { retries: 2, retryOn: (r) => r.status >= 500 },
  );
  expect(res.status).toBe(503);
});

test("fetchWithRetry retries network errors and rethrows the last one", async () => {
  const http = stubHttp([new Error("ECONNRESET"), new Error("ECONNRESET")]);
  await expect(
    fetchWithRetry(http, "u", {}, { retries: 1, retryOn: () => false }),
  ).rejects.toThrow("ECONNRESET");
});

test("mapLimit preserves order and never exceeds the limit", async () => {
  let running = 0;
  let peak = 0;
  const result = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, n));
    running--;
    return n * 10;
  });
  expect(result).toEqual([50, 10, 40, 20, 30]);
  expect(peak).toBe(2);
});
