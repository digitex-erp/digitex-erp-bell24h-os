import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addressFor,
  availableActions,
  flowSteps,
  leadName,
  localDateTimeToIso,
  minScheduleLocal,
  progressPercent,
  shouldPoll,
  statusTone,
} from "../communicationsFlow.js";
import type { CampaignStatus, CommCampaignDetail } from "../../types/communications.js";

function detail(over: Partial<CommCampaignDetail["campaign"]> & { lastTest?: CommCampaignDetail["lastTest"]; verified?: boolean } = {}): CommCampaignDetail {
  const { lastTest = null, verified = false, ...campaign } = over;
  return {
    campaign: {
      id: "c1",
      name: "Camp",
      channel_type: "email",
      template_id: "t1",
      status: "draft",
      total_recipients: 3,
      sent_count: 0,
      failed_count: 0,
      scheduled_at: null,
      consent_confirmed_at: "2026-09-28T00:00:00Z",
      run_count: 0,
      started_at: null,
      completed_at: null,
      paused_reason: null,
      created_at: "2026-09-28T00:00:00Z",
      ...campaign,
    },
    recipientCounts: { pending: 3, queued: 0, sent: 0, failed: 0, cancelled: 0 },
    lastTest,
    testVerified: verified,
  };
}
const sentTest = { id: "m1", status: "sent", recipient: "owner@example.com", error_message: null, created_at: "2026-09-28T00:00:00Z" };
const failedTest = { ...sentTest, status: "failed", error_message: "PROVIDER_NOT_CONFIGURED" };

describe("availableActions — mirrors the server's gates (the server still enforces them)", () => {
  it("a fresh draft: can test and cancel; can NOT schedule or execute, and says why", () => {
    const a = availableActions(detail());
    assert.deepEqual([a.canTest, a.canSchedule, a.canExecute, a.canCancel], [true, false, false, true]);
    assert.match(a.reasons.schedule!, /test message first/);
    assert.match(a.reasons.execute!, /test message first/);
  });

  it("a FAILED test keeps schedule/execute disabled and names the failure", () => {
    const a = availableActions(detail({ lastTest: failedTest }));
    assert.equal(a.canSchedule, false);
    assert.equal(a.canExecute, false);
    assert.match(a.reasons.execute!, /"failed"/);
  });

  it("a queued (not yet sent) test does not unlock anything", () => {
    const a = availableActions(detail({ lastTest: { ...sentTest, status: "queued" } }));
    assert.deepEqual([a.canSchedule, a.canExecute], [false, false]);
  });

  it("a verified test unlocks schedule and execute for draft; execute (resume) for paused; nothing for finished campaigns", () => {
    const draft = availableActions(detail({ lastTest: sentTest, verified: true }));
    assert.deepEqual([draft.canSchedule, draft.canExecute], [true, true]);
    const paused = availableActions(detail({ status: "paused", lastTest: sentTest, verified: true }));
    assert.deepEqual([paused.canSchedule, paused.canExecute, paused.canTest], [false, true, true]);
    for (const s of ["running", "completed", "failed", "cancelled"] as CampaignStatus[]) {
      const a = availableActions(detail({ status: s, lastTest: sentTest, verified: true }));
      assert.deepEqual([a.canSchedule, a.canExecute], [false, false], s);
    }
  });

  it("missing consent or no recipients blocks scheduling/execution even with a verified test", () => {
    assert.equal(availableActions(detail({ consent_confirmed_at: null, lastTest: sentTest, verified: true })).canExecute, false);
    assert.equal(availableActions(detail({ total_recipients: 0, lastTest: sentTest, verified: true })).canSchedule, false);
  });

  it("cancel is offered only while the campaign can still be stopped", () => {
    for (const s of ["draft", "scheduled", "running", "paused"] as CampaignStatus[]) assert.equal(availableActions(detail({ status: s })).canCancel, true, s);
    for (const s of ["completed", "failed", "cancelled"] as CampaignStatus[]) assert.equal(availableActions(detail({ status: s })).canCancel, false, s);
  });
});

describe("flowSteps", () => {
  const states = (d: CommCampaignDetail) => flowSteps(d).map((s) => `${s.key}:${s.state}`);

  it("draft, no test -> the test step is current, later steps are still todo", () => {
    assert.deepEqual(states(detail()), ["select:done", "create:done", "test:current", "schedule:todo", "execute:todo"]);
  });
  it("failed test -> blocked, with the status in the note", () => {
    const s = flowSteps(detail({ lastTest: failedTest }));
    assert.equal(s[2].state, "blocked");
    assert.match(s[2].note!, /failed/);
  });
  it("verified test -> schedule and execute become current", () => {
    assert.deepEqual(states(detail({ lastTest: sentTest, verified: true })), ["select:done", "create:done", "test:done", "schedule:current", "execute:current"]);
  });
  it("scheduled / running / paused / completed / failed", () => {
    assert.deepEqual(states(detail({ status: "scheduled", lastTest: sentTest, verified: true, scheduled_at: "2026-10-01T10:00:00Z" })).slice(3), ["schedule:done", "execute:current"]);
    assert.deepEqual(states(detail({ status: "running", lastTest: sentTest, verified: true })).slice(3), ["schedule:done", "execute:current"]);
    const paused = flowSteps(detail({ status: "paused", paused_reason: "quota", lastTest: sentTest, verified: true }));
    assert.equal(paused[4].state, "blocked");
    assert.match(paused[4].note!, /quota/);
    assert.equal(flowSteps(detail({ status: "completed", lastTest: sentTest, verified: true }))[4].state, "done");
    assert.equal(flowSteps(detail({ status: "failed", lastTest: sentTest, verified: true }))[4].state, "blocked", "a failed campaign is never shown as done");
  });
  it("a cancelled draft offers no 'current' step", () => {
    assert.ok(!states(detail({ status: "cancelled" })).some((s) => s.endsWith(":current")));
  });
});

describe("statusTone", () => {
  it("maps final-success, in-flight, attention and failure states; unknown text is neutral", () => {
    assert.equal(statusTone("delivered"), "success");
    assert.equal(statusTone("completed"), "success");
    assert.equal(statusTone("queued"), "info");
    assert.equal(statusTone("paused"), "warning");
    assert.equal(statusTone("unknown"), "warning");
    assert.equal(statusTone("dead_letter"), "danger");
    assert.equal(statusTone("down"), "danger");
    assert.equal(statusTone("something-else"), "neutral");
  });
});

describe("date helpers", () => {
  it("localDateTimeToIso converts a datetime-local value and rejects junk", () => {
    const iso = localDateTimeToIso("2026-10-01T10:30");
    assert.ok(iso && !Number.isNaN(Date.parse(iso)) && iso.endsWith("Z"));
    for (const bad of ["", "tomorrow", "2026-13-40T99:99", "2026-10-01", "not a date"]) assert.equal(localDateTimeToIso(bad), null, bad);
  });
  it("minScheduleLocal is at least a minute ahead of 'now' (the server requires it) and datetime-local shaped", () => {
    const now = new Date(2026, 8, 28, 23, 59, 30);
    const v = minScheduleLocal(now);
    assert.match(v, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const iso = localDateTimeToIso(v)!;
    assert.ok(Date.parse(iso) - now.getTime() >= 60_000, "must satisfy the server's one-minute minimum");
    assert.equal(v.slice(0, 10), "2026-09-29", "rolls over midnight correctly");
  });
});

describe("progress / labels / polling", () => {
  it("progressPercent counts only final recipient states and is bounded", () => {
    assert.equal(progressPercent({ sent: 2, failed: 1, queued: 5, pending: 2 }, 10), 30);
    assert.equal(progressPercent({}, 0), 0);
    assert.equal(progressPercent({ sent: 50 }, 10), 100);
  });
  it("leadName / addressFor", () => {
    assert.equal(leadName({ first_name: "Asha", last_name: "Rao", email: "a@b.co", phone: null }), "Asha Rao");
    assert.equal(leadName({ first_name: null, last_name: null, email: "a@b.co", phone: null }), "a@b.co");
    assert.equal(leadName({ first_name: null, last_name: null, email: null, phone: null }), "(unnamed)");
    assert.equal(addressFor("email", { email: "a@b.co", phone: "+911" }), "a@b.co");
    assert.equal(addressFor("whatsapp", { email: "a@b.co", phone: "+911" }), "+911");
    assert.equal(addressFor("sms", { email: "a@b.co", phone: null }), "");
  });
  it("shouldPoll: while running/scheduled or while a test is unresolved; not for a settled campaign or null", () => {
    assert.equal(shouldPoll(null), false);
    assert.equal(shouldPoll(detail({ status: "running" })), true);
    assert.equal(shouldPoll(detail({ status: "scheduled" })), true);
    assert.equal(shouldPoll(detail({ lastTest: { ...sentTest, status: "queued" } })), true);
    assert.equal(shouldPoll(detail({ lastTest: sentTest, verified: true })), false);
    assert.equal(shouldPoll(detail({ status: "completed" })), false);
    assert.equal(shouldPoll(detail()), false);
  });
});

import { pipelineWarnings } from "../communicationsFlow.js";

describe("pipelineWarnings — only real, count-derived warnings; never a 'healthy' claim", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const none = { queuedJobs: 0, oldestQueuedAt: null, deadLetterJobs: 0, lastJobCompletedAt: null };
  it("no providers -> danger", () => {
    const n = pipelineWarnings({ total: 0, canSend: 0, credentialsConfigured: 0, verified: 0 }, none, now);
    assert.equal(n[0].tone, "danger");
    assert.match(n[0].text, /No provider is configured/);
  });
  it("providers without credentials -> danger; configured but never verified -> warning", () => {
    assert.match(pipelineWarnings({ total: 2, canSend: 2, credentialsConfigured: 0, verified: 0 }, none, now)[0].text, /none has its credential/);
    const w = pipelineWarnings({ total: 1, canSend: 1, credentialsConfigured: 1, verified: 0 }, none, now);
    assert.deepEqual([w[0].tone, /ever completed a real send/.test(w[0].text)], ["warning", true]);
  });
  it("a verified provider and an idle queue produce NO warnings (and no 'healthy' message)", () => {
    assert.deepEqual(pipelineWarnings({ total: 1, canSend: 1, credentialsConfigured: 1, verified: 1 }, { ...none, lastJobCompletedAt: "2026-09-28T11:59:00Z" }, now), []);
  });
  it("jobs waiting >= 5 minutes flag the trigger; danger if no job has ever completed", () => {
    const ok = { total: 1, canSend: 1, credentialsConfigured: 1, verified: 1 };
    const stale = pipelineWarnings(ok, { queuedJobs: 3, oldestQueuedAt: "2026-09-28T11:40:00Z", deadLetterJobs: 0, lastJobCompletedAt: null }, now);
    assert.equal(stale[0].tone, "danger");
    assert.match(stale[0].text, /3 job\(s\).*20 minute/);
    const seenBefore = pipelineWarnings(ok, { queuedJobs: 3, oldestQueuedAt: "2026-09-28T11:40:00Z", deadLetterJobs: 0, lastJobCompletedAt: "2026-09-28T09:00:00Z" }, now);
    assert.equal(seenBefore[0].tone, "warning");
    assert.deepEqual(pipelineWarnings(ok, { queuedJobs: 1, oldestQueuedAt: "2026-09-28T11:58:00Z", deadLetterJobs: 0, lastJobCompletedAt: "2026-09-28T11:00:00Z" }, now), [], "a job that is only 2 minutes old is normal");
  });
  it("dead-lettered jobs are always surfaced", () => {
    const n = pipelineWarnings({ total: 1, canSend: 1, credentialsConfigured: 1, verified: 1 }, { ...none, deadLetterJobs: 2, lastJobCompletedAt: "2026-09-28T11:00:00Z" }, now);
    assert.equal(n.length, 1);
    assert.match(n[0].text, /2 job\(s\).*dead-lettered/);
  });
});
