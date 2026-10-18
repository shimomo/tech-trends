import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DayFile, IndexFile, SnapshotFile } from "./types.js";

async function writeJson(
  dir: string,
  name: string,
  value: unknown,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, name),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

async function readJson<T>(dir: string, name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(join(dir, name), "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
}

/** docs/data/YYYY-MM-DD.json を上書き */
export async function writeDayFile(dir: string, day: DayFile): Promise<void> {
  await writeJson(dir, `${day.date}.json`, day);
}

/** index.json に date を重複なく入れ、降順で書く */
export async function updateIndex(
  dir: string,
  date: string,
  generatedAt: string,
): Promise<IndexFile> {
  const current = await readJson<IndexFile>(dir, "index.json", {
    dates: [],
    generatedAt,
  });
  const dates = [...new Set([...current.dates, date])].sort((a, b) =>
    a < b ? 1 : -1,
  );
  const next: IndexFile = { dates, generatedAt };
  await writeJson(dir, "index.json", next);
  return next;
}

export async function readSnapshotFile(dir: string): Promise<SnapshotFile> {
  return readJson<SnapshotFile>(dir, "zenn-snapshot.json", { snapshots: [] });
}

export async function writeSnapshotFile(
  dir: string,
  file: SnapshotFile,
): Promise<void> {
  await writeJson(dir, "zenn-snapshot.json", file);
}
