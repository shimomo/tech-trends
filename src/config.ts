import { readFile } from "node:fs/promises";
import type { Config, GithubConfig, ZennConfig } from "./types.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function section(
  root: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const v = root[key];
  if (!isRecord(v)) throw new Error(`config.${key} must be an object`);
  return v;
}

function num(obj: Record<string, unknown>, path: string, key: string): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`${path}.${key} must be a number`);
  }
  return v;
}

function strings(
  obj: Record<string, unknown>,
  path: string,
  key: string,
): string[] {
  const v = obj[key];
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) {
    throw new Error(`${path}.${key} must be an array of strings`);
  }
  return v;
}

function regexes(
  obj: Record<string, unknown>,
  path: string,
  key: string,
): string[] {
  const list = strings(obj, path, key);
  list.forEach((src, i) => {
    try {
      new RegExp(src, "i");
    } catch (e) {
      throw new Error(
        `${path}.${key}[${i}] is not a valid regular expression: ${(e as Error).message}`,
      );
    }
  });
  return list;
}

function parseGithub(g: Record<string, unknown>): GithubConfig {
  const p = "config.github";
  return {
    trendingLists: strings(g, p, "trendingLists"),
    languages: strings(g, p, "languages"),
    topics: strings(g, p, "topics"),
    keywords: regexes(g, p, "keywords"),
    maxItems: num(g, p, "maxItems"),
    hotThreshold: num(g, p, "hotThreshold"),
    newWithinDays: num(g, p, "newWithinDays"),
  };
}

function parseZenn(z: Record<string, unknown>): ZennConfig {
  const p = "config.zenn";
  return {
    topics: strings(z, p, "topics"),
    pagesPerTopic: num(z, p, "pagesPerTopic"),
    windowDays: num(z, p, "windowDays"),
    minLikes: num(z, p, "minLikes"),
    maxItems: num(z, p, "maxItems"),
    hotThreshold: num(z, p, "hotThreshold"),
    newWithinDays: num(z, p, "newWithinDays"),
  };
}

export function parseConfig(json: unknown): Config {
  if (!isRecord(json)) throw new Error("config must be an object");
  return {
    github: parseGithub(section(json, "github")),
    zenn: parseZenn(section(json, "zenn")),
  };
}

export async function loadConfig(path: string): Promise<Config> {
  const text = await readFile(path, "utf8");
  return parseConfig(JSON.parse(text));
}
