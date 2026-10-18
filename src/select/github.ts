import { withinDays } from "../dates.js";
import type { GithubCandidate } from "../sources/github.js";
import type { GithubConfig, Item } from "../types.js";

/** 言語・トピック・キーワードのいずれかで関心領域に当たるか */
export function matchesInterest(
  c: GithubCandidate,
  cfg: GithubConfig,
): boolean {
  if (c.language && cfg.languages.includes(c.language)) return true;
  if (c.topics.some((t) => cfg.topics.includes(t))) return true;
  const haystack = `${c.fullName} ${c.description ?? ""}`;
  return cfg.keywords.some((src) => new RegExp(src, "i").test(haystack));
}

function toItem(c: GithubCandidate, cfg: GithubConfig, today: string): Item {
  const item: Item = {
    id: `github:${c.fullName}`,
    source: "github",
    title: c.fullName,
    url: c.url,
    language: c.language,
    topics: c.topics,
    total: c.stars,
    delta: c.starsToday,
    hot: c.starsToday >= cfg.hotThreshold,
    isNew:
      c.createdAt !== null && withinDays(c.createdAt, today, cfg.newWithinDays),
    publishedAt: c.createdAt ?? "",
  };
  if (c.description) item.description = c.description;
  return item;
}

/** 関心領域で絞り、今日のスター増加数の降順（同数は総スター数）で maxItems 件 */
export function selectGithub(
  candidates: GithubCandidate[],
  cfg: GithubConfig,
  today: string,
): Item[] {
  return candidates
    .filter((c) => matchesInterest(c, cfg))
    .sort((a, b) => b.starsToday - a.starsToday || b.stars - a.stars)
    .slice(0, cfg.maxItems)
    .map((c) => toItem(c, cfg, today));
}
