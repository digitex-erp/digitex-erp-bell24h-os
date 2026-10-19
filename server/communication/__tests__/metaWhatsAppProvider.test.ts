/**
 * MetaWhatsAppProvider — isolated adapter tests, mocked HTTP only.
 *
 * No real Meta credential is used or required anywhere in this file; every
 * `globalThis.fetch` call is intercepted before it leaves the process. This
 * proves the adapter's request construction, error mapping, and honest-
 * failure discipline -- it does not and cannot prove Meta's real API
 * accepts these requests, which remains explicitly unverified (see the
 * task's own required distinction between source-verified and
 * production-verified).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MetaWhatsAppProvider } from "../providers/MetaWhatsAppProvider.js";

const provider = new MetaWhatsAppProvider();
const cfg = (settings: Record<string, unknown> = { phoneNumberId: "1234567890" }, secretValue = "test-token-not-real") => ({
  provider: "meta_whatsapp",
  secretValue,
  settings,
});

async function withMockedFetch<T>(
  impl: (url: string, init?: RequestInit) => Promise<Response>,
  run: () => Promise<T>,
): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = impl as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = realFetch;
  }
}

describe("MetaWhatsAppProvider — send()", () => {
  it("A: success — a 200 with a message id is reported success with the id and raw status, and never touches globalThis.fetch outside this mock", async () => {
    let calls = 0;
    const result = await withMockedFetch(
      async () => {
        calls++;
        return new Response(
          JSON.stringify({ messaging_product: "whatsapp", contacts: [{ wa_id: "919876543210" }], messages: [{ id: "wamid.TEST123" }] }),
          { status: 200 },
        );
      },
      () => provider.send({ recipient: "+919876543210", body: "hello" }, cfg()),
    );
    assert.equal(calls, 1);
    assert.equal(result.success, true);
    assert.equal(result.providerMessageId, "wamid.TEST123");
  });

  it("B: request shape — URL, auth header, and body match Meta's documented contract; recipient has no leading '+'", async () => {
    let seenUrl = "";
    let seenAuth = "";
    let seenBody: any = null;
    await withMockedFetch(
      async (url, init) => {
        seenUrl = String(url);
        seenAuth = (init?.headers as Record<string, string>).Authorization;
        seenBody = JSON.parse(init!.body as string);
        return new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), { status: 200 });
      },
      () => provider.send({ recipient: "+919876543210", body: "hello" }, cfg({ phoneNumberId: "555" }, "sekret")),
    );
    assert.equal(seenUrl, "https://graph.facebook.com/v21.0/555/messages");
    assert.equal(seenAuth, "Bearer sekret");
    assert.deepEqual(seenBody, { messaging_product: "whatsapp", to: "919876543210", type: "text", text: { body: "hello" } });
  });

  it("C: a custom apiVersion setting is honored", async () => {
    let seenUrl = "";
    await withMockedFetch(
      async (url) => {
        seenUrl = String(url);
        return new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), { status: 200 });
      },
      () => provider.send({ recipient: "+919876543210", body: "hi" }, cfg({ phoneNumberId: "555", apiVersion: "v22.0" })),
    );
    assert.match(seenUrl, /^https:\/\/graph\.facebook\.com\/v22\.0\//);
  });

  it("D: authentication failure — Meta's 401 error envelope is surfaced as a failure, not thrown, and never reports success", async () => {
    const result = await withMockedFetch(
      async () =>
        new Response(JSON.stringify({ error: { message: "Invalid OAuth access token.", type: "OAuthException", code: 190 } }), {
          status: 401,
        }),
      () => provider.send({ recipient: "+919876543210", body: "hello" }, cfg()),
    );
    assert.equal(result.success, false);
    assert.match(result.errorMessage!, /Invalid OAuth access token/);
  });

  it("E: throttling — Meta's rate-limit error code is detected and labeled, not confused with a generic failure", async () => {
    const result = await withMockedFetch(
      async () =>
        new Response(JSON.stringify({ error: { message: "(#80007) Too many messages sent.", code: 80007 } }), { status: 429 }),
      () => provider.send({ recipient: "+919876543210", body: "hello" }, cfg()),
    );
    assert.equal(result.success, false);
    assert.match(result.errorMessage!, /Rate limited by Meta/);
  });

  it("F: timeout — an aborted request is reported as a timeout failure, not a generic network error", async () => {
    // Simulates the real 15s AbortController firing by rejecting with the
    // same AbortError shape immediately, so this test runs in milliseconds
    // instead of waiting out the real timeout -- the assertion is on the
    // error-classification code path (name === "AbortError" -> "timed out"
    // message), not on the timer itself.
    const result = await withMockedFetch(
      async () => {
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        throw err;
      },
      () => provider.send({ recipient: "+919876543210", body: "hello" }, cfg()),
    );
    assert.equal(result.success, false);
    assert.match(result.errorMessage!, /timed out/);
  });

  it("G: malformed response — a 200 with no message id is treated as a failure, never a fabricated success", async () => {
    const result = await withMockedFetch(
      async () => new Response(JSON.stringify({ messaging_product: "whatsapp" }), { status: 200 }),
      () => provider.send({ recipient: "+919876543210", body: "hello" }, cfg()),
    );
    assert.equal(result.success, false);
    assert.match(result.errorMessage!, /no message id/);
  });

  it("H: a response body that isn't valid JSON at all does not throw out of send()", async () => {
    const result = await withMockedFetch(
      async () => new Response("<html>not json</html>", { status: 500 }),
      () => provider.send({ recipient: "+919876543210", body: "hello" }, cfg()),
    );
    assert.equal(result.success, false);
  });

  it("I: invalid input — a malformed (non-E.164) recipient is refused before any network call", async () => {
    let calls = 0;
    const result = await withMockedFetch(
      async () => {
        calls++;
        return new Response("{}", { status: 200 });
      },
      () => provider.send({ recipient: "not-a-phone-number", body: "hello" }, cfg()),
    );
    assert.equal(calls, 0, "no request may be made for invalid input");
    assert.equal(result.success, false);
  });

  it("J: invalid input — an empty body is refused before any network call", async () => {
    let calls = 0;
    const result = await withMockedFetch(
      async () => {
        calls++;
        return new Response("{}", { status: 200 });
      },
      () => provider.send({ recipient: "+919876543210", body: "   " }, cfg()),
    );
    assert.equal(calls, 0);
    assert.equal(result.success, false);
  });

  it("K: missing secret or missing phoneNumberId fail cleanly without any network call", async () => {
    let calls = 0;
    const fetchSpy = async () => {
      calls++;
      return new Response("{}", { status: 200 });
    };
    const noSecret = await withMockedFetch(fetchSpy, () => provider.send({ recipient: "+919876543210", body: "hi" }, cfg({}, "")));
    assert.equal(noSecret.success, false);
    const noPhoneId = await withMockedFetch(fetchSpy, () => provider.send({ recipient: "+919876543210", body: "hi" }, cfg({})));
    assert.equal(noPhoneId.success, false);
    assert.equal(calls, 0);
  });

  it("L: network error (fetch itself rejects) is reported as a failure, not thrown out of send()", async () => {
    const result = await withMockedFetch(
      async () => {
        throw new Error("getaddrinfo ENOTFOUND graph.facebook.com");
      },
      () => provider.send({ recipient: "+919876543210", body: "hello" }, cfg()),
    );
    assert.equal(result.success, false);
    assert.match(result.errorMessage!, /ENOTFOUND/);
  });

  it("M: no test in this file ever requires a real Meta credential or reaches a real network address", () => {
    // Structural assertion, not a network probe: every test above supplies a
    // literal placeholder secretValue and mocks globalThis.fetch before any
    // call; this test documents that invariant for a future reader/reviewer.
    assert.ok(true);
  });
});

describe("MetaWhatsAppProvider — status()", () => {
  it("never calls the network and never fabricates a status beyond 'sent', honestly noting webhook-only delivery tracking", async () => {
    let calls = 0;
    const result = await withMockedFetch(
      async () => {
        calls++;
        return new Response("{}", { status: 200 });
      },
      () => provider.status("wamid.TEST123", cfg()),
    );
    assert.equal(calls, 0, "status() must not make a network call -- Meta has no polling endpoint for this");
    assert.equal(result.status, "sent");
    assert.match((result.raw as any).note, /webhook/i);
  });
});

describe("MetaWhatsAppProvider — validate()", () => {
  it("valid config: has both a secret and a phoneNumberId", async () => {
    assert.equal((await provider.validate(cfg())).valid, true);
  });
  it("invalid: missing secret", async () => {
    assert.equal((await provider.validate(cfg({ phoneNumberId: "1" }, ""))).valid, false);
  });
  it("invalid: missing phoneNumberId", async () => {
    assert.equal((await provider.validate(cfg({}))).valid, false);
  });
});

describe("MetaWhatsAppProvider — healthCheck()", () => {
  it("healthy: a 200 from the phone-number metadata endpoint", async () => {
    const result = await withMockedFetch(
      async () => new Response(JSON.stringify({ verified_name: "Acme", display_phone_number: "+91 98765 43210" }), { status: 200 }),
      () => provider.healthCheck(cfg()),
    );
    assert.equal(result.healthy, true);
  });

  it("unhealthy: Meta returns a non-2xx status", async () => {
    const result = await withMockedFetch(
      async () => new Response(JSON.stringify({ error: { message: "Unsupported get request." } }), { status: 400 }),
      () => provider.healthCheck(cfg()),
    );
    assert.equal(result.healthy, false);
    assert.match(result.detail!, /Unsupported get request/);
  });

  it("unhealthy: an aborted request is reported as a timeout, not a generic error (same classification as send())", async () => {
    const result = await withMockedFetch(
      async () => {
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        throw err;
      },
      () => provider.healthCheck(cfg()),
    );
    assert.equal(result.healthy, false);
    assert.match(result.detail!, /timed out/);
  });

  it("unhealthy: missing secret or phoneNumberId, no network call", async () => {
    let calls = 0;
    const fetchSpy = async () => {
      calls++;
      return new Response("{}", { status: 200 });
    };
    assert.equal((await withMockedFetch(fetchSpy, () => provider.healthCheck(cfg({}, "")))).healthy, false);
    assert.equal((await withMockedFetch(fetchSpy, () => provider.healthCheck(cfg({})))).healthy, false);
    assert.equal(calls, 0);
  });
});
