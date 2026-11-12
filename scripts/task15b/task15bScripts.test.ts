/** Guards the Task 15B SQL scripts: preview is read-only, apply only updates the four known tables. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const strip = (s: string) => s.replace(/--.*$/gm, "");
const preview = strip(readFileSync(new URL("./01_preview_counts.sql", import.meta.url), "utf8"));
const apply = strip(readFileSync(new URL("./02_apply.sql", import.meta.url), "utf8"));

test("preview script contains no write statements", () => {
  assert.doesNotMatch(preview, /\b(UPDATE|INSERT|DELETE|DROP|TRUNCATE|ALTER|CREATE)\b/i);
});

test("apply script never deletes or alters schema", () => {
  // "ON COMMIT DROP" only drops the script's own temp table at end of transaction.
  assert.doesNotMatch(apply.replace(/ON COMMIT DROP/gi, ""), /\b(DELETE|DROP|TRUNCATE|ALTER)\b/i);
  assert.doesNotMatch(apply, /CREATE\s+(?!TEMP TABLE _t15b_result)/i);
});

test("apply script updates only the four expected tables, each guarded against terminal states", () => {
  const targets = [...apply.matchAll(/UPDATE\s+public\.(\w+)/gi)].map((m) => m[1]).sort();
  assert.deepEqual(targets, ["image_jobs", "job_queue", "publishing_queue", "video_jobs"]);
  for (const block of apply.split(/UPDATE\s+public\./i).slice(1)) {
    assert.match(block, /status NOT IN \(/i);
  }
  assert.match(apply, /BEGIN;[\s\S]*COMMIT;/);
});
