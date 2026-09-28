import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluate, logStatus, MIN_SUCCESSFUL_RUNS, TICK_PATH } from "../../../scripts/certify-scheduler.js";

const now = new Date("2026-09-28T12:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
const good = {
  id: "s1",
  name: "Bell24h worker tick",
  cronSchedule: "* * * * *",
  url: `https://app.example.com${TICK_PATH}`,
  method: "GET",
  isActive: true,
  headers: { Authorization: "Bearer resolved-secret" },
};
const runs = (statuses: number[]) => statuses.map((s, i) => ({ statusCode: s, executedAt: minutesAgo(i + 1) }));
const failing = (r: ReturnType<typeof evaluate>) => r.checks.filter((c) => !c.ok).map((c) => c.name);

describe("scheduler certification defaults to NOT CERTIFIED", () => {
  it("no schedules at all (the real state of the project today)", () => {
    const r = evaluate({ schedules: [], logs: [], now });
    assert.equal(r.verdict, "NOT CERTIFIED");
    assert.match(r.checks[0].detail, /0 schedule\(s\) exist/);
  });

  it("a schedule that points somewhere else does not count", () => {
    const r = evaluate({ schedules: [{ ...good, url: "https://app.example.com/functions/other" }], logs: runs([200, 200, 200]), now });
    assert.equal(r.verdict, "NOT CERTIFIED");
  });

  it("a correct schedule that has NEVER RUN is not certified", () => {
    const r = evaluate({ schedules: [good], logs: [], now });
    assert.equal(r.verdict, "NOT CERTIFIED");
    assert.ok(failing(r).some((n) => /2xx/.test(n)));
    assert.match(r.checks.find((c) => /2xx/.test(c.name))!.detail, /never run/);
  });

  it("fewer than the minimum successful runs is not certified", () => {
    const r = evaluate({ schedules: [good], logs: runs(Array(MIN_SUCCESSFUL_RUNS - 1).fill(200)), now });
    assert.equal(r.verdict, "NOT CERTIFIED");
  });

  it("any recent non-2xx run is not certified (a 401 means the CRON_SECRET does not match)", () => {
    const r = evaluate({ schedules: [good], logs: runs([200, 200, 200, 401, 200]), now });
    assert.equal(r.verdict, "NOT CERTIFIED");
    assert.ok(failing(r).includes("none of the last 10 runs failed"));
  });

  it("log rows that do not report a status are never treated as success", () => {
    const r = evaluate({ schedules: [good], logs: [{ executedAt: minutesAgo(1) }, { executedAt: minutesAgo(2) }, { executedAt: minutesAgo(3) }], now });
    assert.equal(r.verdict, "NOT CERTIFIED");
  });

  it("a stale history (last run > 24h ago) is not certified", () => {
    const old = [1, 2, 3].map((i) => ({ statusCode: 200, executedAt: new Date(now.getTime() - (30 + i) * 3600_000).toISOString() }));
    assert.equal(evaluate({ schedules: [good], logs: old, now }).verdict, "NOT CERTIFIED");
  });

  it("wrong method, inactive, missing Authorization or plain http each fail", () => {
    for (const bad of [{ method: "POST" }, { isActive: false }, { isActive: undefined }, { headers: {} }, { headers: undefined }, { url: `http://app.example.com${TICK_PATH}` }]) {
      const r = evaluate({ schedules: [{ ...good, ...bad }], logs: runs([200, 200, 200]), now });
      assert.equal(r.verdict, "NOT CERTIFIED", JSON.stringify(bad));
    }
  });

  it("unreadable logs (CLI failure) is not certified", () => {
    assert.equal(evaluate({ schedules: [good], logs: null, now }).verdict, "NOT CERTIFIED");
  });

  it("the optional probe: an unauthenticated tick that is NOT refused fails certification; unreachable also fails", () => {
    const base = { schedules: [good], logs: runs([200, 200, 200]), now };
    assert.equal(evaluate({ ...base, tickProbeStatus: 200 }).verdict, "NOT CERTIFIED");
    assert.equal(evaluate({ ...base, tickProbeStatus: null }).verdict, "NOT CERTIFIED");
    assert.equal(evaluate({ ...base, tickProbeStatus: 401 }).verdict, "CERTIFIED");
  });
});

describe("scheduler certification requires ALL evidence", () => {
  it("CERTIFIED only with an active GET https schedule, an Authorization header, enough recent 2xx runs and (when probed) a refused anonymous call", () => {
    const r = evaluate({ schedules: [good], logs: runs([200, 200, 204, 200]), tickProbeStatus: 401, now });
    assert.equal(r.verdict, "CERTIFIED", JSON.stringify(failing(r)));
  });

  it("never echoes the header value", () => {
    const r = evaluate({ schedules: [good], logs: runs([200, 200, 200]), now });
    assert.ok(!JSON.stringify(r).includes("resolved-secret"));
  });

  it("logStatus reads the common field spellings and rejects non-numbers", () => {
    assert.equal(logStatus({ statusCode: 200 }), 200);
    assert.equal(logStatus({ status_code: 503 }), 503);
    assert.equal(logStatus({ status: "200" }), 200);
    assert.equal(logStatus({ status: "ok" }), undefined);
    assert.equal(logStatus({}), undefined);
  });
});
