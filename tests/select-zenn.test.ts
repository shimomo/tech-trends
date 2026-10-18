import { expect, test } from "vitest";
import { selectZenn } from "../src/select/zenn.js";
import {
  mergeSnapshot,
  previousSnapshot,
  upsertSnapshot,
} from "../src/snapshot.js";
import type { ZennArticle } from "../src/sources/zenn.js";
import type { Snapshot, ZennConfig } from "../src/types.js";

const cfg: ZennConfig = {
  topics: ["llm"],
  pagesPerTopic: 1,
  windowDays: 7,
  minLikes: 10,
  maxItems: 10,
  hotThreshold: 50,
  newWithinDays: 2,
};

const today = "2026-10-19";

function article(
  id: number,
  likedCount: number,
  publishedAt = "2026-10-15T00:00:00+09:00",
  over: Partial<ZennArticle> = {},
): ZennArticle {
  return {
    id,
    title: `title ${id}`,
    url: `https://zenn.dev/u/articles/${id}`,
    likedCount,
    publishedAt,
    username: `user${id}`,
    name: `Name ${id}`,
    emoji: "📝",
    topics: ["llm"],
    ...over,
  };
}

function prevWith(entries: Record<string, number>): Snapshot {
  const articles: Snapshot["articles"] = {};
  for (const [id, likes] of Object.entries(entries))
    articles[id] = { likes, publishedAt: "2026-10-15T00:00:00+09:00" };
  return { date: "2026-10-18", articles };
}

test("delta is the increase since the previous snapshot, floored at 0", () => {
  const items = selectZenn(
    [article(1, 412), article(2, 40)],
    prevWith({ "1": 300, "2": 50 }),
    cfg,
    today,
  );
  expect(items.map((i) => [i.id, i.delta])).toEqual([
    ["zenn:1", 112],
    ["zenn:2", 0],
  ]);
});

test("an article absent from the previous snapshot uses its full like count and is new only if recent", () => {
  const items = selectZenn(
    [
      article(1, 30, "2026-10-18T09:00:00+09:00"),
      article(2, 20, "2026-10-10T09:00:00+09:00"),
    ],
    prevWith({}),
    cfg,
    today,
  );
  expect(items.map((i) => [i.id, i.delta, i.isNew])).toEqual([
    ["zenn:1", 30, true],
    ["zenn:2", 20, false],
  ]);
});

test("filters minLikes, sorts by delta then total, caps maxItems, sets hot", () => {
  const candidates = [
    article(1, 9), // minLikes 未満
    article(2, 100), // delta 60 → hot
    article(3, 70), // delta 30
    article(4, 60), // delta 30, total 低
    ...Array.from({ length: 10 }, (_, i) => article(10 + i, 15)), // delta 5 ずつ
  ];
  const prev = prevWith({
    "2": 40,
    "3": 40,
    "4": 30,
    ...Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [String(10 + i), 10]),
    ),
  });
  const items = selectZenn(candidates, prev, cfg, today);
  expect(items).toHaveLength(10);
  expect(items.slice(0, 3).map((i) => [i.id, i.delta, i.hot])).toEqual([
    ["zenn:2", 60, true],
    ["zenn:3", 30, false],
    ["zenn:4", 30, false],
  ]);
  expect(items.some((i) => i.id === "zenn:1")).toBe(false);
});

test("maps article fields onto an Item, falling back to username when name is empty", () => {
  const [a, b] = selectZenn(
    [
      article(1, 412, "2026-10-16T20:54:20+09:00", { name: "Dev Taro" }),
      article(2, 50, "2026-10-16T00:00:00+09:00", { name: "" }),
    ],
    null,
    cfg,
    today,
  );
  expect(a).toEqual({
    id: "zenn:1",
    source: "zenn",
    title: "title 1",
    url: "https://zenn.dev/u/articles/1",
    author: "Dev Taro",
    emoji: "📝",
    topics: ["llm"],
    total: 412,
    delta: 412,
    hot: true,
    isNew: false,
    publishedAt: "2026-10-16T20:54:20+09:00",
  });
  expect(b?.author).toBe("user2");
});

test("running twice on the same day yields identical items", () => {
  const fetched = [
    article(1, 412),
    article(2, 90, "2026-10-18T09:00:00+09:00"),
  ];
  let file = { snapshots: [prevWith({ "1": 300 })] };
  const first = selectZenn(fetched, previousSnapshot(file, today), cfg, today);
  file = upsertSnapshot(
    file,
    mergeSnapshot(
      previousSnapshot(file, today),
      fetched,
      today,
      cfg.windowDays,
    ),
  );
  const second = selectZenn(fetched, previousSnapshot(file, today), cfg, today);
  expect(second).toEqual(first);
  expect(first.map((i) => [i.delta, i.isNew])).toEqual([
    [112, false],
    [90, true],
  ]);
});
