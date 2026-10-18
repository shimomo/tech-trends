export type Source = "github" | "zenn";

export interface Item {
  id: string;
  source: Source;
  title: string;
  url: string;
  description?: string;
  author?: string;
  emoji?: string;
  language?: string | null;
  topics: string[];
  total: number;
  delta: number;
  hot: boolean;
  isNew: boolean;
  /** ISO 8601。不明なら "" */
  publishedAt: string;
}

export interface CollectError {
  source: Source;
  scope?: string;
  message: string;
}

export interface DayFile {
  date: string;
  generatedAt: string;
  items: Item[];
  errors: CollectError[];
}

export interface IndexFile {
  dates: string[];
  generatedAt: string;
}

export interface SnapshotEntry {
  likes: number;
  publishedAt: string;
}

export interface Snapshot {
  date: string;
  articles: Record<string, SnapshotEntry>;
}

export interface SnapshotFile {
  snapshots: Snapshot[];
}

export interface GithubConfig {
  trendingLists: string[];
  languages: string[];
  topics: string[];
  keywords: string[];
  maxItems: number;
  hotThreshold: number;
  newWithinDays: number;
}

export interface ZennConfig {
  topics: string[];
  pagesPerTopic: number;
  windowDays: number;
  minLikes: number;
  maxItems: number;
  hotThreshold: number;
  newWithinDays: number;
}

export interface Config {
  github: GithubConfig;
  zenn: ZennConfig;
}
