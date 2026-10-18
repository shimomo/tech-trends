import { resolve } from "node:path";
import { runCollect } from "./collect.js";
import { loadConfig } from "./config.js";
import { realHttp } from "./http.js";

const config = await loadConfig("config.json");
const { day, exitCode } = await runCollect({
  config,
  http: realHttp(),
  token: process.env.GITHUB_TOKEN,
  now: new Date(),
  dataDir: resolve("docs/data"),
});

const counts = { github: 0, zenn: 0 };
for (const item of day.items) counts[item.source]++;
console.log(
  `${day.date}: ${counts.github} github + ${counts.zenn} zenn items, ${day.errors.length} errors`,
);
for (const e of day.errors)
  console.error(`  [${e.source}${e.scope ? ` ${e.scope}` : ""}] ${e.message}`);

process.exit(exitCode);
