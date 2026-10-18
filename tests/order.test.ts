import { expect, test } from "vitest";
import { orderItems } from "../src/select/order.js";
import type { Item } from "../src/types.js";

function item(
  id: string,
  source: Item["source"],
  delta: number,
  hot = false,
): Item {
  return {
    id,
    source,
    title: id,
    url: "",
    topics: [],
    total: 0,
    delta,
    hot,
    isNew: false,
    publishedAt: "",
  };
}

test("hot items come first by delta, then sources alternate by rank", () => {
  const github = [
    item("g1", "github", 1900, true),
    item("g2", "github", 880),
    item("g3", "github", 600),
  ];
  const zenn = [item("z1", "zenn", 130, true), item("z2", "zenn", 90)];
  expect(orderItems(github, zenn).map((i) => i.id)).toEqual([
    "g1",
    "z1",
    "g2",
    "z2",
    "g3",
  ]);
});

test("hot items from both sources are interleaved by delta regardless of source", () => {
  const github = [item("g1", "github", 40, true)];
  const zenn = [item("z1", "zenn", 130, true), item("z2", "zenn", 5)];
  expect(orderItems(github, zenn).map((i) => i.id)).toEqual(["z1", "g1", "z2"]);
});

test("one empty source leaves the other in rank order", () => {
  const zenn = [item("z1", "zenn", 30), item("z2", "zenn", 20)];
  expect(orderItems([], zenn).map((i) => i.id)).toEqual(["z1", "z2"]);
  expect(orderItems([], [])).toEqual([]);
});
