import { withinDays } from "./dates.js";
import type { ZennArticle } from "./sources/zenn.js";
import type { Snapshot, SnapshotFile } from "./types.js";

/** today より前の日付のうち最新のスナップショット。無ければ null */
export function previousSnapshot(
  file: SnapshotFile,
  today: string,
): Snapshot | null {
  const older = file.snapshots
    .filter((s) => s.date < today)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return older[0] ?? null;
}

/**
 * 今回取れた記事の値を入れ、前回にあって今回取れなかった記事は
 * 公開日が期間内なら引き継ぐ（部分失敗で偽の NEW を出さないため）。
 */
export function mergeSnapshot(
  prev: Snapshot | null,
  fetched: ZennArticle[],
  today: string,
  windowDays: number,
): Snapshot {
  const articles: Snapshot["articles"] = {};
  for (const [id, entry] of Object.entries(prev?.articles ?? {})) {
    if (withinDays(entry.publishedAt, today, windowDays)) articles[id] = entry;
  }
  for (const a of fetched) {
    articles[String(a.id)] = {
      likes: a.likedCount,
      publishedAt: a.publishedAt,
    };
  }
  return { date: today, articles };
}

/** snap を入れ（同日は差し替え）、snap.date より前で最新の 1 つだけを残す */
export function upsertSnapshot(
  file: SnapshotFile,
  snap: Snapshot,
): SnapshotFile {
  const prev = previousSnapshot(file, snap.date);
  return { snapshots: prev ? [snap, prev] : [snap] };
}
