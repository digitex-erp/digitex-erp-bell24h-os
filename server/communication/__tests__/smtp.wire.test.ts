/**
 * B2 at the wire level: a local mock SMTP server records exactly what the adapter sends,
 * so the assertions are about bytes on the socket, not about what the validator returned.
 */

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { SMTPProvider } from "../providers/SMTPProvider.js";

interface Captured {
  connections: number;
  commands: string[]; // every command line received outside DATA
  messages: string[]; // each DATA payload, dot-unstuffed, without the terminator
}

let server: net.Server;
let port: number;
const seen: Captured = { connections: 0, commands: [], messages: [] };

before(async () => {
  server = net.createServer((socket) => {
    seen.connections++;
    socket.setEncoding("utf8");
    socket.write("220 mock ESMTP\r\n");
    let buf = "";
    let inData = false;
    let data = "";
    socket.on("data", (chunk: string) => {
      buf += chunk;
      while (true) {
        if (inData) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end === -1) return;
          data += buf.slice(0, end);
          buf = buf.slice(end + 5);
          inData = false;
          seen.messages.push(data.replace(/^\.\./gm, "."));
          data = "";
          socket.write("250 2.0.0 queued\r\n");
          continue;
        }
        const idx = buf.indexOf("\r\n");
        if (idx === -1) return;
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        seen.commands.push(line);
        if (/^EHLO/i.test(line)) socket.write("250-mock\r\n250 8BITMIME\r\n");
        else if (/^MAIL FROM/i.test(line) || /^RCPT TO/i.test(line)) socket.write("250 ok\r\n");
        else if (/^DATA/i.test(line)) {
          inData = true;
          socket.write("354 go ahead\r\n");
        } else if (/^QUIT/i.test(line)) socket.end("221 bye\r\n");
        else socket.write("502 unrecognized\r\n");
      }
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seen.connections = 0;
  seen.commands = [];
  seen.messages = [];
});

const smtp = new SMTPProvider();
const config = () => ({
  provider: "smtp",
  secretValue: "unused-no-username",
  settings: { host: "localhost", port, fromAddress: "no-reply@example.com" },
});
// "localhost" resolves to the loopback the mock listens on.

describe("SMTP wire-level behavior", () => {
  it("delivers a normal message with well-formed commands and headers", async () => {
    const r = await smtp.send({ recipient: "buyer@example.com", subject: "RFQ 42", body: "<p>Hello</p>" }, config());
    assert.equal(r.success, true, r.errorMessage);
    assert.ok(seen.commands.includes("MAIL FROM:<no-reply@example.com>"));
    assert.ok(seen.commands.includes("RCPT TO:<buyer@example.com>"));
    assert.equal(seen.messages.length, 1);
    assert.match(seen.messages[0], /^From: no-reply@example\.com\r\nTo: buyer@example\.com\r\nSubject: RFQ 42\r\n/);
    assert.match(seen.messages[0], /\r\n\r\n<p>Hello<\/p>$/);
  });

  it("recipient CRLF injection: rejected and NO connection is even opened", async () => {
    const attacks = [
      "victim@example.com>\r\nRCPT TO:<attacker@evil.test",
      "victim@example.com\r\nRCPT TO:<attacker@evil.test>",
      "victim@example.com\nDATA",
    ];
    for (const recipient of attacks) {
      const r = await smtp.send({ recipient, subject: "s", body: "b" }, config());
      assert.equal(r.success, false);
    }
    assert.equal(seen.connections, 0);
    assert.equal(seen.commands.length, 0);
  });

  it("subject header injection (Bcc: smuggling): rejected before any socket is opened", async () => {
    const r = await smtp.send(
      { recipient: "buyer@example.com", subject: "Quote\r\nBcc: attacker@evil.test", body: "b" },
      config(),
    );
    assert.equal(r.success, false);
    assert.equal(seen.connections, 0);
  });

  it("non-ASCII subjects are RFC2047-encoded so the header stays single-line ASCII", async () => {
    const r = await smtp.send({ recipient: "buyer@example.com", subject: "नमस्ते RFQ", body: "b" }, config());
    assert.equal(r.success, true, r.errorMessage);
    const subjectLine = seen.messages[0].split("\r\n").find((l) => l.startsWith("Subject:"))!;
    assert.match(subjectLine, /^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
  });

  it("SMTP smuggling in the BODY: bare LF/CR terminators are normalized and the payload cannot end DATA early", async () => {
    const evil = "hello\n.\nMAIL FROM:<attacker@evil.test>\nRCPT TO:<victim@example.com>\nDATA\nsmuggled\n.\n";
    const r = await smtp.send({ recipient: "buyer@example.com", subject: "s", body: evil }, config());
    assert.equal(r.success, true, r.errorMessage);
    // Exactly one MAIL FROM / RCPT TO / DATA reached the server: nothing from the body was parsed as a command.
    assert.equal(seen.commands.filter((c) => /^MAIL FROM/i.test(c)).length, 1);
    assert.equal(seen.commands.filter((c) => /^RCPT TO/i.test(c)).length, 1);
    assert.equal(seen.commands.filter((c) => /^DATA/i.test(c)).length, 1);
    assert.ok(!seen.commands.some((c) => c.includes("attacker@evil.test")));
    assert.equal(seen.messages.length, 1);
    // ...and the body survived intact (dot-unstuffing on the server side restores the original lines).
    assert.ok(seen.messages[0].includes("MAIL FROM:<attacker@evil.test>"));
  });

  it("a bare CR in the body cannot be used as a line terminator", async () => {
    const r = await smtp.send({ recipient: "buyer@example.com", subject: "s", body: "a\r.\rRSET\r" }, config());
    assert.equal(r.success, true, r.errorMessage);
    assert.ok(!seen.commands.includes("RSET"));
    assert.ok(!/(^|[^\n])\r(?!\n)/.test(seen.messages[0].split("\r\n\r\n")[1] ?? ""), "no bare CR may remain in the body");
  });

  it("unsafe SMTP host in settings never reaches connect()", async () => {
    const r = await smtp.send(
      { recipient: "buyer@example.com", subject: "s", body: "b" },
      { ...config(), settings: { host: `127.0.0.1:${port}`, fromAddress: "no-reply@example.com" } },
    );
    assert.equal(r.success, false);
    assert.equal(seen.connections, 0);
  });
});
