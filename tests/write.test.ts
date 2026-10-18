import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { DayFile } from "../src/types.js";
import {
  readSnapshotFile,
  updateIndex,
  writeDayFile,
  writeSnapshotFile,
} from "../src/write.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tech-trends-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const t = "2026-10-18T21:05:12.000Z";

function day(date: string, n: number): DayFile {
  return {
    date,
    generatedAt: t,
    items: [],
    errors: Array.from({ length: n }, () => ({ source: "zenn", message: "x" })),
  };
}

test("updateIndex inserts once and sorts descending", async () => {
  await updateIndex(dir, "2026-10-18", t);
  await updateIndex(dir, "2026-10-19", t);
  const idx = await updateIndex(dir, "2026-10-18", t);
  expect(idx.dates).toEqual(["2026-10-19", "2026-10-18"]);
  expect(JSON.parse(await readFile(join(dir, "index.json"), "utf8"))).toEqual({
    dates: ["2026-10-19", "2026-10-18"],
    generatedAt: t,
  });
});

test("updateIndex creates the directory when missing", async () => {
  const nested = join(dir, "docs", "data");
  const idx = await updateIndex(nested, "2026-10-19", t);
  expect(idx.dates).toEqual(["2026-10-19"]);
});

test("writeDayFile overwrites the same date", async () => {
  await writeDayFile(dir, day("2026-10-19", 1));
  await writeDayFile(dir, day("2026-10-19", 0));
  const written = JSON.parse(
    await readFile(join(dir, "2026-10-19.json"), "utf8"),
  );
  expect(written.errors).toEqual([]);
});

test("readSnapshotFile returns an empty file when missing, and round-trips writes", async () => {
  expect(await readSnapshotFile(dir)).toEqual({ snapshots: [] });
  const file = {
    snapshots: [
      { date: "2026-10-19", articles: { "1": { likes: 3, publishedAt: "p" } } },
    ],
  };
  await writeSnapshotFile(dir, file);
  expect(await readSnapshotFile(dir)).toEqual(file);
  expect(await readFile(join(dir, "zenn-snapshot.json"), "utf8")).toContain(
    "\n",
  );
});
