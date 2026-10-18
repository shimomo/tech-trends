import { expect, test } from "vitest";
import {
  dateLabel,
  formatCount,
  formatDelta,
  isStale,
  renderCard,
  resolveDate,
} from "../docs/app.js";
import type { Item } from "../src/types.js";

const item: Item = {
  id: "github:openai/agents-sdk-ts",
  source: "github",
  title: "openai/agents-sdk-ts",
  url: "https://github.com/openai/agents-sdk-ts",
  description: "Build agents",
  language: "TypeScript",
  topics: ["agents"],
  total: 2340,
  delta: 1900,
  hot: false,
  isNew: false,
  publishedAt: "2026-10-15T09:00:00Z",
};

test("formatCount abbreviates thousands", () => {
  expect(formatCount(412)).toBe("412");
  expect(formatCount(999)).toBe("999");
  expect(formatCount(2340)).toBe("2.3k");
  expect(formatCount(14000)).toBe("14k");
  expect(formatCount(215922)).toBe("216k");
});

test("formatDelta shows a signed, grouped number", () => {
  expect(formatDelta(1900)).toBe("+1,900");
  expect(formatDelta(7)).toBe("+7");
  expect(formatDelta(0)).toBe("±0");
});

test("dateLabel appends the Japanese weekday", () => {
  expect(dateLabel("2026-10-18")).toBe("2026-10-18 (日)");
  expect(dateLabel("2026-10-19")).toBe("2026-10-19 (月)");
});

test("isStale is true only after 9:00 JST when today's data is missing", () => {
  expect(isStale("2026-10-18", new Date("2026-10-18T23:30:00Z"))).toBe(false); // JST 10-19 08:30
  expect(isStale("2026-10-18", new Date("2026-10-19T00:00:00Z"))).toBe(true); // JST 10-19 09:00
  expect(isStale("2026-10-19", new Date("2026-10-19T03:00:00Z"))).toBe(false); // today present
  expect(isStale("2026-10-17", new Date("2026-10-18T22:00:00Z"))).toBe(true); // 2 days behind, before 9:00
});

test("resolveDate honours a known hash and falls back to the latest otherwise", () => {
  const dates = ["2026-10-19", "2026-10-18"];
  expect(resolveDate("#2026-10-18", dates)).toEqual({
    date: "2026-10-18",
    fallback: false,
  });
  expect(resolveDate("#2026-10-17", dates)).toEqual({
    date: "2026-10-19",
    fallback: true,
  });
  expect(resolveDate("", dates)).toEqual({
    date: "2026-10-19",
    fallback: false,
  });
  expect(resolveDate("", [])).toEqual({ date: null, fallback: false });
});

test("renderCard escapes html and marks hot/new", () => {
  const html = renderCard({
    ...item,
    title: "<b>x</b>",
    hot: true,
    isNew: true,
  });
  expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  expect(html).not.toContain("<b>x</b>");
  expect(html).toContain('class="card hot"');
  expect(html).toContain("🔥");
  expect(html).toContain('<span class="new">NEW</span>');
});

test("renderCard shows source-specific counters and a link", () => {
  const gh = renderCard(item);
  expect(gh).toContain('class="card"');
  expect(gh).toContain('href="https://github.com/openai/agents-sdk-ts"');
  expect(gh).toContain("★ 2.3k");
  expect(gh).toContain("+1,900");
  expect(gh).toContain("GitHub");
  expect(gh).toContain("TypeScript");
  expect(gh).not.toContain("NEW");

  const zn = renderCard({
    ...item,
    id: "zenn:1",
    source: "zenn",
    title: "記事",
    author: "dev_taro",
    emoji: "🧪",
    topics: ["nextjs"],
    total: 412,
    delta: 130,
  });
  expect(zn).toContain("♥ 412");
  expect(zn).toContain("+130");
  expect(zn).toContain("Zenn");
  expect(zn).toContain("dev_taro");
  expect(zn).toContain("🧪");
});
