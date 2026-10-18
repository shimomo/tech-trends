import { jstDate } from "./dates.js";
import type { Http } from "./http.js";
import { selectGithub } from "./select/github.js";
import { orderItems } from "./select/order.js";
import { selectZenn } from "./select/zenn.js";
import { mergeSnapshot, previousSnapshot, upsertSnapshot } from "./snapshot.js";
import { collectGithub } from "./sources/github.js";
import { collectZenn } from "./sources/zenn.js";
import type { Config, DayFile } from "./types.js";
import {
  readSnapshotFile,
  updateIndex,
  writeDayFile,
  writeSnapshotFile,
} from "./write.js";

export interface RunDeps {
  config: Config;
  http: Http;
  token?: string;
  now: Date;
  dataDir: string;
}

/**
 * 収集 → 選別 → 書き出し。errors が 1 件でもあれば exitCode 1。
 * 書き出しは必ず終えてから exitCode を返す。
 */
export async function runCollect(
  deps: RunDeps,
): Promise<{ day: DayFile; exitCode: 0 | 1 }> {
  const { config, http, token, now, dataDir } = deps;
  const today = jstDate(now);

  const [github, zenn] = await Promise.all([
    collectGithub(config.github, http, token),
    collectZenn(config.zenn, http, today),
  ]);

  const snapshotFile = await readSnapshotFile(dataDir);
  const prev = previousSnapshot(snapshotFile, today);

  const githubItems = selectGithub(github.candidates, config.github, today);
  const zennItems = selectZenn(zenn.candidates, prev, config.zenn, today);

  const day: DayFile = {
    date: today,
    generatedAt: now.toISOString(),
    items: orderItems(githubItems, zennItems),
    errors: [...github.errors, ...zenn.errors],
  };

  await writeDayFile(dataDir, day);
  await updateIndex(dataDir, today, day.generatedAt);

  const zennFailedEntirely =
    zenn.candidates.length === 0 && zenn.errors.length > 0;
  if (!zennFailedEntirely) {
    const snap = mergeSnapshot(
      prev,
      zenn.candidates,
      today,
      config.zenn.windowDays,
    );
    await writeSnapshotFile(dataDir, upsertSnapshot(snapshotFile, snap));
  }

  return { day, exitCode: day.errors.length > 0 ? 1 : 0 };
}
