import { withinDays } from "../dates.js";
import type { ZennArticle } from "../sources/zenn.js";
import type { Item, Snapshot, ZennConfig } from "../types.js";

interface Scored {
  article: ZennArticle;
  delta: number;
  isNew: boolean;
}

function score(
  a: ZennArticle,
  prev: Snapshot | null,
  cfg: ZennConfig,
  today: string,
): Scored {
  const before = prev?.articles[String(a.id)];
  if (before)
    return {
      article: a,
      delta: Math.max(0, a.likedCount - before.likes),
      isNew: false,
    };
  return {
    article: a,
    delta: a.likedCount,
    isNew: withinDays(a.publishedAt, today, cfg.newWithinDays),
  };
}

function toItem({ article: a, delta, isNew }: Scored, cfg: ZennConfig): Item {
  return {
    id: `zenn:${a.id}`,
    source: "zenn",
    title: a.title,
    url: a.url,
    author: a.name || a.username,
    emoji: a.emoji,
    topics: a.topics,
    total: a.likedCount,
    delta,
    hot: delta >= cfg.hotThreshold,
    isNew,
    publishedAt: a.publishedAt,
  };
}

/** minLikes で絞り、前日比増加の降順（同数は総いいね数）で maxItems 件 */
export function selectZenn(
  candidates: ZennArticle[],
  prev: Snapshot | null,
  cfg: ZennConfig,
  today: string,
): Item[] {
  return candidates
    .filter((a) => a.likedCount >= cfg.minLikes)
    .map((a) => score(a, prev, cfg, today))
    .sort(
      (x, y) =>
        y.delta - x.delta || y.article.likedCount - x.article.likedCount,
    )
    .slice(0, cfg.maxItems)
    .map((s) => toItem(s, cfg));
}
