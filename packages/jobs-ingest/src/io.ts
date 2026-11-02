import { readFileSync } from "node:fs";
import { Job } from "@talksume/core";

export function readJobs(path: string): Job[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => Job.parse(JSON.parse(l)));
}
