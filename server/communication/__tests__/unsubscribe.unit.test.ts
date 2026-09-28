import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildUnsubscribeUrl, getUnsubscribeConfig, signUnsubscribeToken, verifyUnsubscribeToken } from "../unsubscribe.js";
import { CommunicationValidationError, validateHeaderUrl } from "../validation.js";

const SECRET = "unit-test-secret-0123456789abcdef";
const claims = { organizationId: "11111111-1111-1111-1111-111111111111", channel: "email" as const, address: "buyer@example.com" };

describe("unsubscribe configuration fails closed", () => {
  it("needs BOTH a long-enough secret and a valid http(s) base URL", () => {
    assert.deepEqual(getUnsubscribeConfig({ COMM_UNSUBSCRIBE_SECRET: SECRET, COMM_PUBLIC_BASE_URL: "https://os.example.com/some/path?x=1" }), {
      secret: SECRET,
      baseUrl: "https://os.example.com",
    });
    for (const env of [
      {},
      { COMM_UNSUBSCRIBE_SECRET: SECRET },
      { COMM_PUBLIC_BASE_URL: "https://os.example.com" },
      { COMM_UNSUBSCRIBE_SECRET: "short", COMM_PUBLIC_BASE_URL: "https://os.example.com" },
      { COMM_UNSUBSCRIBE_SECRET: SECRET, COMM_PUBLIC_BASE_URL: "not a url" },
      { COMM_UNSUBSCRIBE_SECRET: SECRET, COMM_PUBLIC_BASE_URL: "javascript:alert(1)" },
      { COMM_UNSUBSCRIBE_SECRET: SECRET, COMM_PUBLIC_BASE_URL: "ftp://os.example.com" },
    ]) {
      assert.equal(getUnsubscribeConfig(env), null, JSON.stringify(env));
    }
  });
});

describe("unsubscribe tokens cannot be forged or altered", () => {
  it("round-trips and yields exactly the signed claims", () => {
    const t = signUnsubscribeToken(claims, SECRET);
    assert.deepEqual(verifyUnsubscribeToken(t, SECRET), claims);
    assert.match(t, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, "URL-safe");
  });

  it("rejects a wrong secret, a tampered payload, a tampered signature, and malformed input", () => {
    const t = signUnsubscribeToken(claims, SECRET);
    assert.equal(verifyUnsubscribeToken(t, "another-secret-0123456789abcdef"), null);
    const [payload, mac] = t.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ o: "22222222-2222-2222-2222-222222222222", c: "email", a: "victim@example.com", v: 1 })).toString("base64url");
    assert.equal(verifyUnsubscribeToken(`${forgedPayload}.${mac}`, SECRET), null, "payload swapped, original signature kept");
    assert.equal(verifyUnsubscribeToken(`${payload}.${mac.slice(0, -2)}AA`, SECRET), null);
    for (const bad of [undefined, null, 5, "", ".", "a.", ".b", "a.b.c", "x".repeat(3000), ["a.b"], { t }]) {
      assert.equal(verifyUnsubscribeToken(bad, SECRET), null, JSON.stringify(bad)?.slice(0, 40));
    }
  });

  it("rejects a correctly-signed token whose claims are malformed (bad version / channel / types)", () => {
    const sign = (obj: unknown) => {
      const payload = Buffer.from(JSON.stringify(obj)).toString("base64url");
      return `${payload}.${crypto.createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
    };
    assert.equal(verifyUnsubscribeToken(sign({ o: "x", c: "email", a: "a@b.co", v: 2 }), SECRET), null);
    assert.equal(verifyUnsubscribeToken(sign({ o: "x", c: "voice", a: "a@b.co", v: 1 }), SECRET), null);
    assert.equal(verifyUnsubscribeToken(sign({ o: 1, c: "email", a: "a@b.co", v: 1 }), SECRET), null);
    assert.equal(verifyUnsubscribeToken(sign("not-an-object"), SECRET), null);
    assert.deepEqual(verifyUnsubscribeToken(sign({ o: "org", c: "sms", a: "+919876543210", v: 1 }), SECRET), { organizationId: "org", channel: "sms", address: "+919876543210" });
  });

  it("the link carries no secret and no database id, only the signed claims", () => {
    const url = buildUnsubscribeUrl({ secret: SECRET, baseUrl: "https://os.example.com" }, claims);
    assert.match(url, /^https:\/\/os\.example\.com\/api\/communications\/unsubscribe\?t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.ok(!url.includes(SECRET));
    assert.doesNotThrow(() => validateHeaderUrl(url), "it must be usable as a List-Unsubscribe header value");
  });
});

describe("validateHeaderUrl — a URL is safe to put in a header", () => {
  it("accepts plain http(s) URLs", () => {
    for (const ok of ["https://os.example.com/api/communications/unsubscribe?t=abc.def", "http://localhost:3000/x"]) assert.equal(validateHeaderUrl(ok), ok);
  });
  it("rejects header injection, angle brackets, whitespace, quotes, other schemes and oversize values", () => {
    for (const bad of [
      "https://x.com/a\r\nBcc: attacker@evil.test",
      "https://x.com/a\nX: y",
      "https://x.com/<script>",
      "https://x.com/a b",
      'https://x.com/"quoted"',
      "https://x.com/'q'",
      "https://x.com/a`b",
      "javascript:alert(1)",
      "ftp://x.com/a",
      "//x.com/a",
      "https://exämple.com/",
      "",
      "https://x.com/" + "a".repeat(2000),
      undefined,
      42,
    ]) {
      assert.throws(() => validateHeaderUrl(bad), CommunicationValidationError, String(bad).slice(0, 40));
    }
  });
});
