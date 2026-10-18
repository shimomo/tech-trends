import { fetchWithRetry, type Http, mapLimit } from "../http.js";
import type { CollectError, GithubConfig } from "../types.js";
import { parseTrending, type TrendingRow } from "./trending.js";

export interface GithubCandidate extends TrendingRow {
  url: string;
  topics: string[];
  createdAt: string | null;
  enriched: boolean;
}

export interface RepoDetails {
  topics: string[];
  createdAt: string;
  description: string | null;
  language: string | null;
  stars: number;
  url: string;
}

const TRENDING_HEADERS = {
  "user-agent": "Mozilla/5.0 (compatible; tech-trends collector)",
  accept: "text/html",
};

const ENRICH_CONCURRENCY = 5;

function trendingUrl(language: string): string {
  return language
    ? `https://github.com/trending/${encodeURIComponent(language)}?since=daily`
    : "https://github.com/trending?since=daily";
}

/** Trending の 1 リストを取得。HTTP エラー、または 0 行なら throw */
export async function fetchTrendingList(
  language: string,
  http: Http,
): Promise<TrendingRow[]> {
  const res = await http.fetch(trendingUrl(language), {
    headers: TRENDING_HEADERS,
  });
  if (!res.ok)
    throw new Error(`HTTP ${res.status} fetching trending list "${language}"`);
  const rows = parseTrending(await res.text());
  if (rows.length === 0)
    throw new Error(
      `trending list "${language}" parsed to 0 rows (html structure changed?)`,
    );
  return rows;
}

/** GET /repos/{fullName}。404 は null。403/429/5xx はリトライし、駄目なら throw */
export async function enrichRepo(
  fullName: string,
  http: Http,
  token?: string,
): Promise<RepoDetails | null> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "tech-trends collector",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetchWithRetry(
    http,
    `https://api.github.com/repos/${fullName}`,
    { headers },
    {
      retries: 3,
      retryOn: (r) => r.status === 403 || r.status === 429 || r.status >= 500,
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching repo ${fullName}`);
  const body = (await res.json()) as {
    topics?: string[];
    created_at: string;
    description: string | null;
    language: string | null;
    stargazers_count: number;
    html_url: string;
  };
  return {
    topics: body.topics ?? [],
    createdAt: body.created_at,
    description: body.description,
    language: body.language,
    stars: body.stargazers_count,
    url: body.html_url,
  };
}

async function fetchListWithRetry(
  language: string,
  http: Http,
): Promise<TrendingRow[]> {
  try {
    return await fetchTrendingList(language, http);
  } catch {
    return fetchTrendingList(language, http);
  }
}

function mergeRows(lists: TrendingRow[][]): TrendingRow[] {
  const byName = new Map<string, TrendingRow>();
  for (const row of lists.flat()) {
    const existing = byName.get(row.fullName);
    if (!existing || row.starsToday > existing.starsToday)
      byName.set(row.fullName, row);
  }
  return [...byName.values()];
}

export async function collectGithub(
  cfg: GithubConfig,
  http: Http,
  token?: string,
): Promise<{ candidates: GithubCandidate[]; errors: CollectError[] }> {
  const errors: CollectError[] = [];
  if (!token)
    console.warn(
      "GITHUB_TOKEN is not set: GitHub API calls are anonymous (60 requests/hour)",
    );

  const lists = await Promise.all(
    cfg.trendingLists.map(async (language) => {
      try {
        return await fetchListWithRetry(language, http);
      } catch (e) {
        errors.push({
          source: "github",
          scope: `list:${language}`,
          message: (e as Error).message,
        });
        return [];
      }
    }),
  );

  const enriched = await mapLimit(
    mergeRows(lists),
    ENRICH_CONCURRENCY,
    async (row): Promise<GithubCandidate | null> => {
      try {
        const details = await enrichRepo(row.fullName, http, token);
        if (details === null) return null;
        return {
          ...row,
          description: details.description ?? row.description,
          language: details.language ?? row.language,
          stars: details.stars,
          url: details.url,
          topics: details.topics,
          createdAt: details.createdAt,
          enriched: true,
        };
      } catch (e) {
        errors.push({
          source: "github",
          scope: `repo:${row.fullName}`,
          message: (e as Error).message,
        });
        return {
          ...row,
          url: `https://github.com/${row.fullName}`,
          topics: [],
          createdAt: null,
          enriched: false,
        };
      }
    },
  );

  return {
    candidates: enriched.filter((c): c is GithubCandidate => c !== null),
    errors,
  };
}
