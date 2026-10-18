import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { runCollect } from "../src/collect.js";
import { parseConfig } from "../src/config.js";
import type { Http } from "../src/http.js";

const trendingHtml = readFileSync(
  "tests/fixtures/trending-typescript.html",
  "utf8",
);
const zennJson = readFileSync("tests/fixtures/zenn-llm-daily.json", "utf8");
const config = parseConfig(JSON.parse(readFileSync("config.json", "utf8")));
const now = new Date("2026-10-18T21:05:12Z"); // JST 2026-10-19 06:05

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tech-trends-collect-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function stubHttp(
  opts: { zennStatus?: number; githubStatus?: number } = {},
): Http {
  return {
    sleep: async () => {},
    fetch: async (input) => {
      const url = String(input);
      if (url.startsWith("https://github.com/trending")) {
        return new Response(trendingHtml, { status: opts.githubStatus ?? 200 });
      }
      if (url.startsWith("https://api.github.com/repos/")) {
        const fullName = url.slice("https://api.github.com/repos/".length);
        return Response.json({
          html_url: `https://github.com/${fullName}`,
          description: "d",
          language: "TypeScript",
          stargazers_count: 500,
          created_at: "2026-10-15T00:00:00Z",
          topics: [],
        });
      }
      if (url.startsWith("https://zenn.dev/api/articles")) {
        return new Response(opts.zennStatus ? "" : zennJson, {
          status: opts.zennStatus ?? 200,
        });
      }
      throw new Error(`unexpected url ${url}`);
    },
  };
}

async function readJson(name: string) {
  return JSON.parse(await readFile(join(dir, name), "utf8"));
}

test("writes the day file, index and snapshot and exits 0 on success", async () => {
  const { day, exitCode } = await runCollect({
    config,
    http: stubHttp(),
    token: "t",
    now,
    dataDir: dir,
  });
  expect(exitCode).toBe(0);
  expect(day.date).toBe("2026-10-19");
  expect(day.generatedAt).toBe("2026-10-18T21:05:12.000Z");
  expect(day.errors).toEqual([]);
  expect(day.items.some((i) => i.source === "github")).toBe(true);
  expect(day.items.some((i) => i.source === "zenn")).toBe(true);
  expect(await readJson("2026-10-19.json")).toEqual(day);
  expect((await readJson("index.json")).dates).toEqual(["2026-10-19"]);
  expect((await readJson("zenn-snapshot.json")).snapshots[0].date).toBe(
    "2026-10-19",
  );
});

test("a failing source still writes the file, records the error and exits 1", async () => {
  const { day, exitCode } = await runCollect({
    config,
    http: stubHttp({ zennStatus: 503 }),
    token: "t",
    now,
    dataDir: dir,
  });
  expect(exitCode).toBe(1);
  expect(day.errors.length).toBeGreaterThan(0);
  expect(day.errors.every((e) => e.source === "zenn")).toBe(true);
  expect(day.items.some((i) => i.source === "github")).toBe(true);
  expect(day.items.some((i) => i.source === "zenn")).toBe(false);
  await expect(stat(join(dir, "2026-10-19.json"))).resolves.toBeTruthy();
  await expect(stat(join(dir, "zenn-snapshot.json"))).rejects.toThrow();
});

test("both sources failing writes an empty items file and exits 1", async () => {
  const { day, exitCode } = await runCollect({
    config,
    http: stubHttp({ zennStatus: 503, githubStatus: 500 }),
    token: "t",
    now,
    dataDir: dir,
  });
  expect(exitCode).toBe(1);
  expect(day.items).toEqual([]);
  expect(day.errors.some((e) => e.source === "github")).toBe(true);
  expect(day.errors.some((e) => e.source === "zenn")).toBe(true);
  expect((await readJson("2026-10-19.json")).items).toEqual([]);
});

test("rerunning on the same day does not duplicate the index date", async () => {
  await runCollect({ config, http: stubHttp(), token: "t", now, dataDir: dir });
  await runCollect({ config, http: stubHttp(), token: "t", now, dataDir: dir });
  expect((await readJson("index.json")).dates).toEqual(["2026-10-19"]);
  expect((await readJson("zenn-snapshot.json")).snapshots).toHaveLength(1);
});
