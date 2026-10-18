import { type HTMLElement, parse } from "node-html-parser";

export interface TrendingRow {
  fullName: string;
  description: string | null;
  language: string | null;
  stars: number;
  starsToday: number;
}

function toNumber(text: string | undefined | null): number {
  if (!text) return 0;
  const n = Number(text.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function parseRow(row: HTMLElement): TrendingRow | null {
  const href = row.querySelector("h2 a")?.getAttribute("href");
  if (!href) return null;
  const fullName = href.replace(/^\//, "").split("?")[0] ?? "";
  if (!fullName.includes("/")) return null;

  const description = row.querySelector("p")?.text.trim() || null;
  const language =
    row.querySelector('span[itemprop="programmingLanguage"]')?.text.trim() ||
    null;
  const stars = toNumber(row.querySelector('a[href$="/stargazers"]')?.text);
  const today = row.text.match(/([\d,]+)\s+stars?\s+today/);
  const starsToday = today ? toNumber(today[1]) : 0;

  return { fullName, description, language, stars, starsToday };
}

/** GitHub Trending ページの HTML から行を取り出す。行が無ければ [] */
export function parseTrending(html: string): TrendingRow[] {
  const root = parse(html);
  const rows: TrendingRow[] = [];
  for (const article of root.querySelectorAll("article.Box-row")) {
    const row = parseRow(article);
    if (row) rows.push(row);
  }
  return rows;
}
