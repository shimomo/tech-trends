import { expect, test } from "vitest";
import {
  mergeSnapshot,
  previousSnapshot,
  upsertSnapshot,
} from "../src/snapshot.js";
import type { ZennArticle } from "../src/sources/zenn.js";
import type { Snapshot, SnapshotFile } from "../src/types.js";

function snap(date: string, articles: Snapshot["articles"] = {}): Snapshot {
  return { date, articles };
}

function article(
  id: number,
  likedCount: number,
  publishedAt: string,
): ZennArticle {
  return {
    id,
    title: `t${id}`,
    url: `u${id}`,
    likedCount,
    publishedAt,
    username: "u",
    name: "n",
    emoji: "x",
    topics: [],
  };
}

test("previousSnapshot ignores today's own snapshot", () => {
  const file: SnapshotFile = {
    snapshots: [snap("2026-10-19"), snap("2026-10-18")],
  };
  expect(previousSnapshot(file, "2026-10-19")?.date).toBe("2026-10-18");
});

test("previousSnapshot works across a gap of several days", () => {
  const file: SnapshotFile = { snapshots: [snap("2026-10-14")] };
  expect(previousSnapshot(file, "2026-10-19")?.date).toBe("2026-10-14");
});

test("previousSnapshot returns null when nothing is older", () => {
  expect(
    previousSnapshot({ snapshots: [snap("2026-10-19")] }, "2026-10-19"),
  ).toBeNull();
  expect(previousSnapshot({ snapshots: [] }, "2026-10-19")).toBeNull();
});

test("mergeSnapshot carries over unfetched articles still inside the window", () => {
  const prev = snap("2026-10-18", {
    "1": { likes: 100, publishedAt: "2026-10-15T00:00:00+09:00" },
    "2": { likes: 5, publishedAt: "2026-10-05T00:00:00+09:00" },
  });
  const merged = mergeSnapshot(
    prev,
    [article(3, 42, "2026-10-18T10:00:00+09:00")],
    "2026-10-19",
    7,
  );
  expect(merged).toEqual({
    date: "2026-10-19",
    articles: {
      "1": { likes: 100, publishedAt: "2026-10-15T00:00:00+09:00" },
      "3": { likes: 42, publishedAt: "2026-10-18T10:00:00+09:00" },
    },
  });
});

test("mergeSnapshot prefers fetched values over carried ones and works without a previous snapshot", () => {
  const prev = snap("2026-10-18", {
    "1": { likes: 100, publishedAt: "2026-10-15T00:00:00+09:00" },
  });
  expect(
    mergeSnapshot(
      prev,
      [article(1, 130, "2026-10-15T00:00:00+09:00")],
      "2026-10-19",
      7,
    ).articles["1"]?.likes,
  ).toBe(130);
  expect(
    mergeSnapshot(
      null,
      [article(1, 7, "2026-10-19T00:00:00+09:00")],
      "2026-10-19",
      7,
    ).articles,
  ).toEqual({
    "1": { likes: 7, publishedAt: "2026-10-19T00:00:00+09:00" },
  });
});

test("upsertSnapshot replaces the same date and keeps exactly one earlier snapshot", () => {
  const file: SnapshotFile = {
    snapshots: [
      snap("2026-10-19", { old: { likes: 1, publishedAt: "" } }),
      snap("2026-10-18"),
      snap("2026-10-17"),
    ],
  };
  const fresh = snap("2026-10-19", { fresh: { likes: 2, publishedAt: "" } });
  expect(upsertSnapshot(file, fresh)).toEqual({
    snapshots: [fresh, snap("2026-10-18")],
  });
});

test("upsertSnapshot on an empty file keeps only the new snapshot", () => {
  expect(upsertSnapshot({ snapshots: [] }, snap("2026-10-19"))).toEqual({
    snapshots: [snap("2026-10-19")],
  });
});
