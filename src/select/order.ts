import type { Item } from "../types.js";

/** 🔥 を先頭に delta 降順。残りは GitHub と Zenn を順位ごとに交互に並べる */
export function orderItems(github: Item[], zenn: Item[]): Item[] {
  const hot = [...github, ...zenn]
    .filter((i) => i.hot)
    .sort((a, b) => b.delta - a.delta);
  const g = github.filter((i) => !i.hot);
  const z = zenn.filter((i) => !i.hot);
  const rest: Item[] = [];
  for (let i = 0; i < Math.max(g.length, z.length); i++) {
    const gi = g[i];
    const zi = z[i];
    if (gi) rest.push(gi);
    if (zi) rest.push(zi);
  }
  return [...hot, ...rest];
}
