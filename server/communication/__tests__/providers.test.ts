import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedSecretRef,
  MissingSecretError,
  ProviderFactory,
  SECRET_REF_ALLOWLIST,
  SecretNotAllowedError,
  UnknownProviderError,
} from "../providers/ProviderFactory.js";
import { ResendProvider } from "../providers/ResendProvider.js";
import { SMTPProvider } from "../providers/SMTPProvider.js";
import { MSG91Provider } from "../providers/StubProviders.js";

const cfg = (provider: string, settings: Record<string, unknown> = {}, secretValue = "s3cret") => ({ provider, secretValue, settings });

describe("B1 — credential allowlist", () => {
  it("allows each provider's own conventional and namespaced names", () => {
    const allowed: Array<[string, string]> = [
      ["resend", "RESEND_API_KEY"],
      ["resend", "COMM_RESEND_ACME_PROD"],
      ["smtp", "SMTP_PASSWORD"],
      ["smtp", "COMM_SMTP_PRIMARY"],
      ["meta_whatsapp", "META_WHATSAPP_ACCESS_TOKEN"],
      ["meta_whatsapp", "COMM_META_ORG1"],
      ["msg91", "MSG91_AUTH_KEY"],
      ["msg91", "COMM_MSG91_OTP"],
    ];
    for (const [provider, ref] of allowed) assert.equal(isAllowedSecretRef(provider, ref), true, `${provider}:${ref}`);
  });

  it("denies arbitrary environment variables — the original B1 exploit", () => {
    const targets = [
      "DATABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SERVICE_KEY",
      "SUPABASE_KEY",
      "CRON_SECRET",
      "OPENAI_API_KEY",
      "GEMINI_API_KEY",
      "BELL24H_VYAPARSETHU_SERVICE_TOKEN",
      "PATH",
      "NODE_ENV",
      "HOME",
    ];
    for (const provider of Object.keys(SECRET_REF_ALLOWLIST)) {
      for (const t of targets) assert.equal(isAllowedSecretRef(provider, t), false, `${provider} must not read ${t}`);
    }
  });

  it("a provider cannot reference ANOTHER provider's credential", () => {
    assert.equal(isAllowedSecretRef("resend", "SMTP_PASSWORD"), false);
    assert.equal(isAllowedSecretRef("smtp", "RESEND_API_KEY"), false);
    assert.equal(isAllowedSecretRef("smtp", "COMM_RESEND_X"), false);
    assert.equal(isAllowedSecretRef("meta_whatsapp", "MSG91_AUTH_KEY"), false);
    assert.equal(isAllowedSecretRef("msg91", "COMM_META_X"), false);
  });

  it("rejects malformed names: case, whitespace, newlines, prefixes/suffixes, empty namespace, non-strings", () => {
    const bad = [
      "resend_api_key",
      "RESEND_API_KEY ",
      " RESEND_API_KEY",
      "RESEND_API_KEY\n",
      "RESEND_API_KEY\nDATABASE_URL",
      "XRESEND_API_KEY",
      "RESEND_API_KEY_2",
      "COMM_RESEND_",
      "COMM_RESEND_lowercase",
      "COMM_RESEND_A-B",
      "COMM_RESEND_" + "A".repeat(65),
      "",
      "__proto__",
      "constructor",
    ];
    for (const b of bad) assert.equal(isAllowedSecretRef("resend", b), false, JSON.stringify(b));
    for (const v of [undefined, null, 1, {}, ["RESEND_API_KEY"]]) assert.equal(isAllowedSecretRef("resend", v), false);
  });

  it("unknown / prototype-key providers have no allowlist entry", () => {
    for (const p of ["twilio", "gupshup", "exotel", "__proto__", "constructor", "toString", "hasOwnProperty", ""]) {
      assert.equal(isAllowedSecretRef(p, "RESEND_API_KEY"), false, p);
    }
  });

  describe("resolveSecret never reads the environment for a denied name", () => {
    const SENTINEL = "SENTINEL_VALUE_MUST_NOT_LEAK";
    let saved: string | undefined;
    beforeEach(() => {
      saved = process.env.DATABASE_URL;
      process.env.DATABASE_URL = SENTINEL;
    });
    afterEach(() => {
      if (saved === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = saved;
    });

    it("throws SecretNotAllowedError without echoing the requested name or the value", () => {
      for (const provider of ["resend", "smtp", "meta_whatsapp", "msg91"]) {
        try {
          ProviderFactory.resolveSecret(provider, "DATABASE_URL");
          assert.fail("should have thrown");
        } catch (err) {
          assert.ok(err instanceof SecretNotAllowedError);
          assert.ok(!err.message.includes(SENTINEL));
          assert.ok(!err.message.includes("DATABASE_URL"), "attacker-controlled name must not be echoed");
        }
      }
    });

    it("buildResolvedConfig enforces the same rule", () => {
      assert.throws(() => ProviderFactory.buildResolvedConfig("smtp", "DATABASE_URL", {}), SecretNotAllowedError);
    });
  });

  it("allowed name resolves from env; allowed-but-unset throws MissingSecretError", () => {
    process.env.COMM_RESEND_TEST_A = "value-a";
    try {
      assert.equal(ProviderFactory.resolveSecret("resend", "COMM_RESEND_TEST_A"), "value-a");
      delete process.env.COMM_RESEND_TEST_A;
      assert.throws(() => ProviderFactory.resolveSecret("resend", "COMM_RESEND_TEST_A"), MissingSecretError);
    } finally {
      delete process.env.COMM_RESEND_TEST_A;
    }
  });
});

describe("approved provider set (strategy: Resend + SMTP, Meta WhatsApp, MSG91 SMS)", () => {
  it("registers exactly the four approved providers", () => {
    for (const ok of ["resend", "smtp", "meta_whatsapp", "msg91"]) assert.ok(ProviderFactory.getAdapter(ok));
    assert.deepEqual(Object.keys(SECRET_REF_ALLOWLIST).sort(), ["meta_whatsapp", "msg91", "resend", "smtp"]);
  });

  it("removed / deferred / prototype-key providers do not resolve", () => {
    for (const bad of ["twilio", "twilio_sms", "twilio_whatsapp", "msg91_whatsapp", "gupshup", "exotel", "__proto__", "constructor", "toString"]) {
      assert.throws(() => ProviderFactory.getAdapter(bad), UnknownProviderError, bad);
    }
  });

  it("channel mapping: MSG91 is SMS-only, Meta is WhatsApp-only", () => {
    assert.equal(ProviderFactory.getAdapter("msg91").channelType, "sms");
    assert.equal(ProviderFactory.getAdapter("meta_whatsapp").channelType, "whatsapp");
    assert.equal(ProviderFactory.getAdapter("resend").channelType, "email");
    assert.equal(ProviderFactory.getAdapter("smtp").channelType, "email");
  });
});

describe("stub providers (the real MSG91 adapter is Sprint C2; Meta is a real but UNVERIFIED adapter since CH-02)", () => {
  for (const [name, adapter] of [["MSG91", new MSG91Provider()]] as const) {
    it(`${name}: send / status / healthCheck throw loudly; validate reports invalid`, async () => {
      await assert.rejects(() => adapter.send({ recipient: "+919876543210", body: "x" }, cfg(adapter.provider)), /non-functional stub/);
      await assert.rejects(() => adapter.status("id", cfg(adapter.provider)), /non-functional stub/);
      await assert.rejects(() => adapter.healthCheck(cfg(adapter.provider)), /non-functional stub/);
      const v = await adapter.validate(cfg(adapter.provider));
      assert.equal(v.valid, false);
    });
  }
});

describe("Resend adapter — validation (no network)", () => {
  const resend = new ResendProvider();

  it("validate(): good, missing key, missing/invalid from", async () => {
    assert.equal((await resend.validate(cfg("resend", { fromAddress: "no-reply@example.com" }))).valid, true);
    assert.equal((await resend.validate(cfg("resend", { fromAddress: "no-reply@example.com" }, ""))).valid, false);
    assert.equal((await resend.validate(cfg("resend", {}))).valid, false);
    assert.equal((await resend.validate(cfg("resend", { fromAddress: "x@y.com\r\nBcc: z@z.com" }))).valid, false);
  });

  it("send() refuses injected recipient/subject BEFORE any network call", async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const settings = { fromAddress: "no-reply@example.com" };
      const bad = await resend.send({ recipient: "a@example.com\r\nBcc: x@evil.test", subject: "s", body: "b" }, cfg("resend", settings));
      assert.equal(bad.success, false);
      const bad2 = await resend.send({ recipient: "a@example.com", subject: "s\r\nBcc: x@evil.test", body: "b" }, cfg("resend", settings));
      assert.equal(bad2.success, false);
      assert.equal(calls, 0, "no request may be made for invalid input");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("send() forwards a stable Idempotency-Key header so a worker re-run cannot double-send", async () => {
    const realFetch = globalThis.fetch;
    let headers: Record<string, string> = {};
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      headers = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ id: "re_123" }), { status: 200 });
    }) as typeof fetch;
    try {
      const r = await resend.send(
        { recipient: "a@example.com", subject: "s", body: "b", idempotencyKey: "comm-msg:abc:0" },
        cfg("resend", { fromAddress: "no-reply@example.com" }),
      );
      assert.equal(r.success, true);
      assert.equal(headers["Idempotency-Key"], "comm-msg:abc:0");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("SMTP adapter — settings validation (no network)", () => {
  const smtp = new SMTPProvider();
  const good = { host: "smtp.example.com", port: 587, fromAddress: "no-reply@example.com" };

  it("accepts valid settings", async () => {
    assert.equal((await smtp.validate(cfg("smtp", good))).valid, true);
  });

  it("rejects unsafe host, port, and from address without throwing", async () => {
    for (const s of [
      { ...good, host: "smtp.example.com\r\nEHLO evil" },
      { ...good, host: "evil.com:25" },
      { ...good, host: "a b.com" },
      { ...good, port: 0 },
      { ...good, port: 99999 },
      { ...good, port: "abc" },
      { ...good, fromAddress: "a@example.com>\r\nRCPT TO:<x@evil.test" },
      { ...good, fromAddress: "not-an-email" },
    ]) {
      const v = await smtp.validate(cfg("smtp", s));
      assert.equal(v.valid, false, JSON.stringify(s));
    }
  });

  it("send() with unsafe settings fails cleanly instead of opening a socket", async () => {
    const r = await smtp.send({ recipient: "a@example.com", subject: "s", body: "b" }, cfg("smtp", { ...good, host: "bad host" }));
    assert.equal(r.success, false);
  });

  it("healthCheck() with unsafe settings reports unhealthy without throwing", async () => {
    const h = await smtp.healthCheck(cfg("smtp", { ...good, host: "bad host" }));
    assert.equal(h.healthy, false);
  });
});
