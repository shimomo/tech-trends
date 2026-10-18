import { withinDays } from "../dates.js";
import type { Http } from "../http.js";
import type { CollectError, ZennConfig } from "../types.js";

export interface ZennArticle {
  id: number;
  title: string;
  url: string;
  likedCount: number;
  publishedAt: string;
  username: string;
  name: string;
  emoji: string;
  topics: string[];
}

interface ApiArticle {
  id: number;
  title: string;
  path: string;
  liked_count: number;
  published_at: string;
  emoji: string;
  user: { username: string; name: string };
}

interface ApiPage {
  articles: ApiArticle[];
  next_page: number | null;
}

const PAGE_SIZE = 48;
const RETRY_PAUSE_MS = 5000;

function topicUrl(topic: string, page: number): string {
  return `https://zenn.dev/api/articles?topicname=${encodeURIComponent(topic)}&order=daily&count=${PAGE_SIZE}&page=${page}`;
}

function toArticle(a: ApiArticle, topic: string): ZennArticle {
  return {
    id: a.id,
    title: a.title,
    url: `https://zenn.dev${a.path}`,
    likedCount: a.liked_count,
    publishedAt: a.published_at,
    username: a.user.username,
    name: a.user.name,
    emoji: a.emoji,
    topics: [topic],
  };
}

/** 1 トピックのデイリートレンドを pages ページまで取る。next_page が null なら打ち切り。HTTP エラーは throw */
export async function fetchZennTopic(
  topic: string,
  pages: number,
  http: Http,
): Promise<ZennArticle[]> {
  const out: ZennArticle[] = [];
  for (let page = 1; page <= pages; page++) {
    const res = await http.fetch(topicUrl(topic, page), {
      headers: { accept: "application/json" },
    });
    if (!res.ok)
      throw new Error(
        `HTTP ${res.status} fetching zenn topic "${topic}" page ${page}`,
      );
    const body = (await res.json()) as ApiPage;
    out.push(...body.articles.map((a) => toArticle(a, topic)));
    if (body.next_page === null) break;
  }
  return out;
}

async function fetchTopicWithRetry(
  topic: string,
  pages: number,
  http: Http,
): Promise<ZennArticle[]> {
  try {
    return await fetchZennTopic(topic, pages, http);
  } catch {
    await http.sleep(RETRY_PAUSE_MS);
    return fetchZennTopic(topic, pages, http);
  }
}

export async function collectZenn(
  cfg: ZennConfig,
  http: Http,
  today: string,
): Promise<{ candidates: ZennArticle[]; errors: CollectError[] }> {
  const errors: CollectError[] = [];
  const byId = new Map<number, ZennArticle>();

  for (const topic of cfg.topics) {
    let articles: ZennArticle[];
    try {
      articles = await fetchTopicWithRetry(topic, cfg.pagesPerTopic, http);
    } catch (e) {
      errors.push({
        source: "zenn",
        scope: `topic:${topic}`,
        message: (e as Error).message,
      });
      continue;
    }
    for (const a of articles) {
      const existing = byId.get(a.id);
      if (existing) {
        if (!existing.topics.includes(topic)) existing.topics.push(topic);
        existing.likedCount = Math.max(existing.likedCount, a.likedCount);
      } else {
        byId.set(a.id, a);
      }
    }
  }

  const candidates = [...byId.values()].filter((a) =>
    withinDays(a.publishedAt, today, cfg.windowDays),
  );
  return { candidates, errors };
}
