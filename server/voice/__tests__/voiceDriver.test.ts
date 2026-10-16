/**
 * Pure unit tests for the voice driver -- no database, no real network call.
 * global.fetch is stubbed for the Dograh cases, matching the convention
 * already used in server/ai/ProviderRouter.test.ts.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  simulatedDriver,
  dograhDriver,
  getDriver,
  fromDograhPayload,
  isDograhPayload,
  mapDograhOutcome,
  maskPhone,
} from "../voiceDriver.js";

const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const name of ["DOGRAH_BASE_URL", "DOGRAH_AGENT_ID", "DOGRAH_API_KEY"]) {
  ORIGINAL_ENV[name] = process.env[name];
}
let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = global.fetch;
  for (const name of ["DOGRAH_BASE_URL", "DOGRAH_AGENT_ID", "DOGRAH_API_KEY"]) {
    delete process.env[name];
  }
});
afterEach(() => {
  global.fetch = originalFetch;
  for (const name of ["DOGRAH_BASE_URL", "DOGRAH_AGENT_ID", "DOGRAH_API_KEY"]) {
    const v = ORIGINAL_ENV[name];
    if (v === undefined) delete process.env[name];
    else process.env[name] = v;
  }
});

const BASE_INPUT = {
  ref: "VT-TEST-1",
  contactName: "Acme Supplier",
  company: "Acme Co",
  phone: "+919876543210",
  objective: "Confirm pricing",
  language: "en-IN",
  rfq: null,
};

test("getDriver('simulated') and the default (unknown name) both return the simulated driver", () => {
  assert.equal(getDriver("simulated").name, "simulated");
  assert.equal(getDriver(null).name, "simulated");
  assert.equal(getDriver(undefined).name, "simulated");
  assert.equal(getDriver("something-else").name, "simulated");
});

test("getDriver('dograh') returns the real driver, never silently falls back", () => {
  assert.equal(getDriver("dograh").name, "dograh");
  assert.equal(getDriver("dograh").simulated, false);
});

test("simulated driver is explicitly labelled simulated=true and returns a deterministic capture", async () => {
  assert.equal(simulatedDriver.simulated, true);
  const r1 = await simulatedDriver.dispatch(BASE_INPUT);
  const r2 = await simulatedDriver.dispatch(BASE_INPUT);
  assert.equal(r1.accepted, true);
  assert.ok(r1.capture);
  // Deterministic per ref -- same input, same outcome.
  assert.deepEqual(r1.capture, r2.capture);
  assert.equal(r1.driverJobId, `sim-${BASE_INPUT.ref}`);
});

test("simulated driver never contacts the network", async () => {
  let called = false;
  global.fetch = (async () => {
    called = true;
    throw new Error("fetch must never be called by the simulated driver");
  }) as any;
  await simulatedDriver.dispatch(BASE_INPUT);
  assert.equal(called, false);
});

test("dograh driver fails closed with a specific error when DOGRAH_BASE_URL/DOGRAH_AGENT_ID are missing -- never falls back to simulation", async () => {
  const result = await dograhDriver.dispatch(BASE_INPUT);
  assert.equal(result.accepted, false);
  assert.equal(result.capture, null);
  assert.match(result.error!, /DOGRAH_BASE_URL/);
  assert.match(result.error!, /DOGRAH_AGENT_ID/);
});

test("dograh driver fails closed when the task has no phone number", async () => {
  process.env.DOGRAH_BASE_URL = "https://dograh.example.test";
  process.env.DOGRAH_AGENT_ID = "agent-1";
  const result = await dograhDriver.dispatch({ ...BASE_INPUT, phone: null });
  assert.equal(result.accepted, false);
  assert.match(result.error!, /phone_number/);
});

test("dograh driver: a successful trigger returns accepted=true with no inline capture (async -- capture arrives via webhook)", async () => {
  process.env.DOGRAH_BASE_URL = "https://dograh.example.test";
  process.env.DOGRAH_AGENT_ID = "agent-1";
  process.env.DOGRAH_API_KEY = "test-key-not-real";
  let capturedUrl = "";
  let capturedHeaders: any = {};
  global.fetch = (async (url: string, init: any) => {
    capturedUrl = url;
    capturedHeaders = init.headers;
    return new Response(JSON.stringify({ workflow_run_id: 999 }), { status: 200 });
  }) as any;

  const result = await dograhDriver.dispatch(BASE_INPUT);
  assert.equal(result.accepted, true);
  assert.equal(result.capture, null);
  assert.equal(result.driverJobId, "999");
  assert.equal(capturedUrl, "https://dograh.example.test/api/v1/public/agent/agent-1");
  assert.equal(capturedHeaders["X-API-Key"], "test-key-not-real");
});

test("dograh driver: a non-2xx response is translated into an actionable error, not thrown raw", async () => {
  process.env.DOGRAH_BASE_URL = "https://dograh.example.test";
  process.env.DOGRAH_AGENT_ID = "agent-1";
  global.fetch = (async () => new Response(JSON.stringify({ detail: "no telephony provider" }), { status: 400 })) as any;

  const result = await dograhDriver.dispatch(BASE_INPUT);
  assert.equal(result.accepted, false);
  assert.match(result.error!, /HTTP 400/);
  assert.match(result.error!, /no telephony provider/);
});

test("dograh driver: a timeout is reported distinctly from an unreachable host", async () => {
  process.env.DOGRAH_BASE_URL = "https://dograh.example.test";
  process.env.DOGRAH_AGENT_ID = "agent-1";
  global.fetch = (async () => {
    const err = new Error("aborted");
    err.name = "TimeoutError";
    throw err;
  }) as any;

  const result = await dograhDriver.dispatch(BASE_INPUT);
  assert.equal(result.accepted, false);
  assert.match(result.error!, /did not respond within 15s/);
});

test("mapDograhOutcome covers every documented disposition and is case/space tolerant", () => {
  assert.equal(mapDograhOutcome("Completed"), "captured");
  assert.equal(mapDograhOutcome("no answer"), "no_answer");
  assert.equal(mapDograhOutcome("Not Interested"), "declined");
  assert.equal(mapDograhOutcome("ERROR"), "failed");
  assert.equal(mapDograhOutcome("something-unmapped"), null);
});

test("fromDograhPayload: a completed call with no extracted data is NOT silently marked interested", () => {
  const result = fromDograhPayload({
    workflow_run_id: 5,
    initial_context: { task_ref: "VT-1" },
    gathered_context: { call_disposition: "completed" },
  });
  assert.equal(result.capture.outcome, "captured");
  assert.equal(result.capture.interested, false, "no price/moq/delivery/explicit-interest flag means not interested");
});

test("fromDograhPayload: a completed call WITH a quote is marked interested", () => {
  const result = fromDograhPayload({
    workflow_run_id: 6,
    initial_context: { task_ref: "VT-2" },
    gathered_context: { call_disposition: "completed", price: "₹1,240 per unit", moq: "50 units", delivery_days: "10" },
  });
  assert.equal(result.capture.interested, true);
  assert.equal(result.capture.price, 1240);
  assert.equal(result.capture.deliveryDays, 10);
});

test("isDograhPayload rejects an unrelated body shape", () => {
  assert.equal(isDograhPayload({ foo: "bar" }), false);
  assert.equal(isDograhPayload({ gathered_context: {} }), true);
});

test("maskPhone never exposes more than the last 4 digits", () => {
  assert.equal(maskPhone("+919876543210"), "••••••3210");
  assert.equal(maskPhone(null), "—");
});
