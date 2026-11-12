import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFlag } from "./featureFlags.js";

test("client flags are on only for the exact string 'true'", () => {
  assert.equal(parseFlag("true"), true);
  for (const v of [undefined, "", "TRUE", "1", "false", true, null]) {
    assert.equal(parseFlag(v), false, String(v));
  }
});
