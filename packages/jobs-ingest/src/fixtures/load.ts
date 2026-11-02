import { readFileSync } from "node:fs";

export function loadFixture<T = { items: unknown[]; details?: unknown[] }>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), "utf8")) as T;
}
