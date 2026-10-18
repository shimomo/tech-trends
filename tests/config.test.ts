import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { loadConfig, parseConfig } from "../src/config.js";

const validConfig = JSON.parse(readFileSync("config.json", "utf8"));

describe("config", () => {
  test("parseConfig accepts the shipped config.json", async () => {
    const cfg = await loadConfig("config.json");
    expect(cfg.github.maxItems).toBe(10);
    expect(cfg.zenn.topics).toContain("react");
  });

  test("parseConfig rejects a non-number threshold with the path in the message", () => {
    const bad = structuredClone(validConfig);
    bad.zenn.hotThreshold = "50";
    expect(() => parseConfig(bad)).toThrow(
      "config.zenn.hotThreshold must be a number",
    );
  });

  test("parseConfig rejects an invalid keyword regex", () => {
    const bad = structuredClone(validConfig);
    bad.github.keywords = ["("];
    expect(() => parseConfig(bad)).toThrow("config.github.keywords[0]");
  });

  test("parseConfig rejects a missing string array", () => {
    const bad = structuredClone(validConfig);
    delete bad.zenn.topics;
    expect(() => parseConfig(bad)).toThrow(
      "config.zenn.topics must be an array of strings",
    );
  });
});
