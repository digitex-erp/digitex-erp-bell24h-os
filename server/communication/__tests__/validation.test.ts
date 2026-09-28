import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CommunicationValidationError,
  encodeHeaderValue,
  normalizeToCrlf,
  validateBody,
  validateChannel,
  validateEmailAddress,
  validateIdempotencyKey,
  validatePhoneNumber,
  validateRecipient,
  validateSmtpHost,
  validateSmtpPort,
  validateSubject,
} from "../validation.js";
import { getDailyQuota } from "../CommunicationService.js";

const rejects = (fn: () => unknown) => assert.throws(fn, CommunicationValidationError);

describe("B2 — email address validation", () => {
  it("accepts ordinary addresses", () => {
    for (const ok of ["a@example.com", "first.last+tag@sub.example.co.in", "o'brien@example.org", "x_y@ex-ample.com"]) {
      assert.equal(validateEmailAddress(ok), ok);
    }
  });

  it("rejects every CR/LF injection shape that would add SMTP commands or headers", () => {
    const attacks = [
      "victim@example.com\r\nRCPT TO:<attacker@evil.test>",
      "victim@example.com\nBcc: attacker@evil.test",
      "victim@example.com\rBcc: attacker@evil.test",
      "victim@example.com>\r\nDATA\r\n",
      "victim@example.com Bcc: a@evil.test",
      "victim@example.com\0",
      "vic\r\ntim@example.com",
    ];
    for (const a of attacks) rejects(() => validateEmailAddress(a));
  });

  it("rejects malformed and dangerous forms", () => {
    const bad = [
      "",
      "no-at-sign",
      "a@b",
      "a@@b.com",
      "a b@example.com",
      "<a@example.com>",
      "a@example.com,b@example.com",
      "a@example.com;b@example.com",
      '"quoted"@example.com',
      "a@[127.0.0.1]",
      "a@example..com",
      "a@-example.com",
      `${"x".repeat(250)}@example.com`,
    ];
    for (const b of bad) rejects(() => validateEmailAddress(b));
  });

  it("rejects non-strings", () => {
    for (const v of [undefined, null, 42, {}, ["a@example.com"]]) rejects(() => validateEmailAddress(v));
  });
});

describe("B2 — subject / header validation", () => {
  it("passes null/undefined through as null and accepts normal text incl. unicode", () => {
    assert.equal(validateSubject(undefined), null);
    assert.equal(validateSubject(null), null);
    assert.equal(validateSubject("RFQ #42 — नमस्ते"), "RFQ #42 — नमस्ते");
  });

  it("rejects header injection", () => {
    for (const s of ["hi\r\nBcc: a@evil.test", "hi\nBcc: a@evil.test", "hi\rX: y", "hi x", "hi x", "hi\0", "hi\u001b[2J"]) {
      rejects(() => validateSubject(s));
    }
  });

  it("rejects over-long subjects and non-strings", () => {
    rejects(() => validateSubject("x".repeat(201)));
    rejects(() => validateSubject(123));
  });

  it("RFC2047-encodes non-ASCII header values and leaves ASCII alone", () => {
    assert.equal(encodeHeaderValue("Plain subject"), "Plain subject");
    const enc = encodeHeaderValue("नमस्ते");
    assert.match(enc, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    assert.equal(Buffer.from(enc.slice(10, -2), "base64").toString("utf8"), "नमस्ते");
    assert.ok(!/[\r\n]/.test(enc));
  });
});

describe("B2 — body handling", () => {
  it("normalizes CR, LF and CRLF to CRLF (SMTP smuggling defence)", () => {
    assert.equal(normalizeToCrlf("a\nb\rc\r\nd"), "a\r\nb\r\nc\r\nd");
    assert.equal(normalizeToCrlf("\n.\n"), "\r\n.\r\n");
  });

  it("rejects empty, NUL-bearing and oversize bodies", () => {
    rejects(() => validateBody(""));
    rejects(() => validateBody("a\u0000b"));
    rejects(() => validateBody("x".repeat(100_001)));
    assert.equal(validateBody("<p>hello</p>"), "<p>hello</p>");
  });
});

describe("recipient / channel validation", () => {
  it("E.164 phone numbers only", () => {
    assert.equal(validatePhoneNumber("+919876543210"), "+919876543210");
    for (const bad of ["9876543210", "+0123456789", "+91 98765 43210", "+91-9876543210", "+1234", "+9198765432101234", "+91987\r\n65432"]) {
      rejects(() => validatePhoneNumber(bad));
    }
  });

  it("validateRecipient dispatches by channel", () => {
    assert.equal(validateRecipient("email", "a@example.com"), "a@example.com");
    assert.equal(validateRecipient("whatsapp", "+919876543210"), "+919876543210");
    rejects(() => validateRecipient("email", "+919876543210"));
    rejects(() => validateRecipient("sms", "a@example.com"));
  });

  it("only approved channels are sendable — no voice/push, no removed providers", () => {
    for (const ok of ["email", "sms", "whatsapp"]) assert.equal(validateChannel(ok), ok);
    for (const bad of ["voice", "push", "twilio", "twilio_sms", "WHATSAPP_MSG91", "EMAIL", "", null, undefined, 1, ["email"]]) {
      rejects(() => validateChannel(bad));
    }
  });
});

describe("B3 — idempotency key validation", () => {
  it("accepts 8-128 chars of [A-Za-z0-9._:-]", () => {
    for (const ok of ["abcdefgh", "3f2b8c1e-9d4a-4b7e-8a1c-0d5e6f7a8b9c", "order:42.retry-1_x", "a".repeat(128)]) {
      assert.equal(validateIdempotencyKey(ok), ok);
    }
  });
  it("rejects short, long, spaced, control-char and non-string keys", () => {
    for (const bad of ["short", "a".repeat(129), "has space 123", "new\nline-1234", "-leadingdash1", "emoji-😀-12345", "", undefined, 12345678]) {
      rejects(() => validateIdempotencyKey(bad));
    }
  });
});

describe("SMTP settings validation", () => {
  it("hosts", () => {
    assert.equal(validateSmtpHost("smtp.example.com"), "smtp.example.com");
    for (const bad of ["", "smtp.example.com\r\nX", "host name", "a;b.com", "-bad.com", "a..com", "127.0.0.1:25", "evil.com/path", "x".repeat(254)]) {
      rejects(() => validateSmtpHost(bad));
    }
  });
  it("ports", () => {
    assert.equal(validateSmtpPort(587), 587);
    assert.equal(validateSmtpPort("465"), 465);
    for (const bad of [0, -1, 65536, 25.5, "abc", "", null, NaN, "25; rm -rf"]) rejects(() => validateSmtpPort(bad));
  });
});

describe("B3 — quota configuration", () => {
  it("has finite defaults per approved channel", () => {
    assert.equal(getDailyQuota("email", {}), 1000);
    assert.equal(getDailyQuota("sms", {}), 200);
    assert.equal(getDailyQuota("whatsapp", {}), 500);
  });
  it("honors a valid override, including 0 (channel disabled)", () => {
    assert.equal(getDailyQuota("email", { COMM_QUOTA_EMAIL_PER_DAY: "25" } as NodeJS.ProcessEnv), 25);
    assert.equal(getDailyQuota("sms", { COMM_QUOTA_SMS_PER_DAY: "0" } as NodeJS.ProcessEnv), 0);
  });
  it("a malformed override falls back to the default — it can never disable the limit", () => {
    for (const bad of ["abc", "-5", "1.5", "Infinity", "1e9x"]) {
      assert.equal(getDailyQuota("email", { COMM_QUOTA_EMAIL_PER_DAY: bad } as NodeJS.ProcessEnv), 1000);
    }
  });
  it("unknown channels get quota 0 (deny), not unlimited", () => {
    assert.equal(getDailyQuota("voice", {}), 0);
  });
});
