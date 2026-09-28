/**
 * The one-click unsubscribe headers (RFC 8058) at the provider boundary: what SMTP puts on the socket and what Resend
 * is sent. Both adapters must (a) emit List-Unsubscribe + List-Unsubscribe-Post exactly when an unsubscribe URL is
 * supplied, (b) refuse a URL that could inject headers, and (c) send nothing extra for messages without one.
 */
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { SMTPProvider } from "../providers/SMTPProvider.js";
import { ResendProvider } from "../providers/ResendProvider.js";

const URL_OK = "https://os.example.test/api/communications/unsubscribe?t=abc.def";

// ---- SMTP: a mock server records the DATA payload -------------------------------------------------------------
let server: net.Server;
let port: number;
let connections = 0;
let messages: string[] = [];

before(async () => {
  server = net.createServer((socket) => {
    connections++;
    socket.setEncoding("utf8");
    socket.write("220 mock ESMTP\r\n");
    let buf = "";
    let inData = false;
    socket.on("data", (chunk: string) => {
      buf += chunk;
      for (;;) {
        if (inData) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end === -1) return;
          messages.push(buf.slice(0, end));
          buf = buf.slice(end + 5);
          inData = false;
          socket.write("250 2.0.0 queued\r\n");
          continue;
        }
        const idx = buf.indexOf("\r\n");
        if (idx === -1) return;
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (/^EHLO/i.test(line)) socket.write("250-mock\r\n250 8BITMIME\r\n");
        else if (/^(MAIL FROM|RCPT TO)/i.test(line)) socket.write("250 ok\r\n");
        else if (/^DATA/i.test(line)) {
          inData = true;
          socket.write("354 go\r\n");
        } else if (/^QUIT/i.test(line)) socket.end("221 bye\r\n");
        else socket.write("502 no\r\n");
      }
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  connections = 0;
  messages = [];
});

const smtp = new SMTPProvider();
const smtpConfig = () => ({ provider: "smtp", secretValue: "unused", settings: { host: "localhost", port, fromAddress: "no-reply@example.com" } });

describe("SMTP List-Unsubscribe", () => {
  it("adds both headers, in the header block (before the blank line), when an unsubscribe URL is supplied", async () => {
    const r = await smtp.send({ recipient: "buyer@example.com", subject: "s", body: "<p>x</p>", unsubscribeUrl: URL_OK }, smtpConfig());
    assert.equal(r.success, true, r.errorMessage);
    const [head, body] = messages[0].split("\r\n\r\n");
    assert.ok(head.split("\r\n").includes(`List-Unsubscribe: <${URL_OK}>`));
    assert.ok(head.split("\r\n").includes("List-Unsubscribe-Post: List-Unsubscribe=One-Click"));
    assert.equal(body, "<p>x</p>");
  });

  it("adds nothing when there is no URL (single sends are unchanged)", async () => {
    await smtp.send({ recipient: "buyer@example.com", subject: "s", body: "b" }, smtpConfig());
    assert.ok(!/List-Unsubscribe/i.test(messages[0]));
  });

  it("refuses a URL that could smuggle headers: fails, and NO connection is opened", async () => {
    for (const bad of [`${URL_OK}\r\nBcc: attacker@evil.test`, `${URL_OK}\nX: y`, "javascript:alert(1)", "https://x.com/<a>", "https://x.com/a b"]) {
      const r = await smtp.send({ recipient: "buyer@example.com", subject: "s", body: "b", unsubscribeUrl: bad }, smtpConfig());
      assert.equal(r.success, false, bad);
    }
    assert.equal(connections, 0);
    assert.equal(messages.length, 0);
  });
});

// ---- Resend: the JSON request body ------------------------------------------------------------------------------
const resend = new ResendProvider();
const resendConfig = () => ({ provider: "resend", secretValue: "re_test_not_real", settings: { fromAddress: "no-reply@example.com" } });

async function captureResendBody(unsubscribeUrl?: string) {
  const realFetch = globalThis.fetch;
  let sent: any = null;
  let calls = 0;
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
    calls++;
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "em_1" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const r = await resend.send({ recipient: "buyer@example.com", subject: "s", body: "<p>x</p>", unsubscribeUrl }, resendConfig());
    return { r, sent, calls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

describe("Resend List-Unsubscribe", () => {
  it("sends the two headers in the API's headers object when an unsubscribe URL is supplied", async () => {
    const { r, sent } = await captureResendBody(URL_OK);
    assert.equal(r.success, true, r.errorMessage);
    assert.deepEqual(sent.headers, { "List-Unsubscribe": `<${URL_OK}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  });

  it("sends no headers object at all when there is no URL", async () => {
    const { sent } = await captureResendBody(undefined);
    assert.equal("headers" in sent, false);
  });

  it("refuses an injectable URL before any request is made", async () => {
    const { r, calls } = await captureResendBody(`${URL_OK}\r\nBcc: attacker@evil.test`);
    assert.equal(r.success, false);
    assert.equal(calls, 0);
  });
});
