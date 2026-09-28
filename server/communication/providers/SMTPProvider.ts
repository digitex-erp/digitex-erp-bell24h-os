/**
 * Email provider — raw SMTP (RFC 5321/5322), via Node's built-in `net`/`tls`.
 *
 * No new dependency (no nodemailer) — matches this codebase's existing
 * convention of talking to external services over a raw protocol/fetch
 * rather than pulling in a vendor SDK (see server/ai/GeminiProvider.ts,
 * ResendProvider.ts).
 *
 * Settings (communication_providers.settings, non-secret):
 *   host: string (required)
 *   port?: number (default 587)
 *   secure?: boolean (true = TLS from connect, e.g. port 465; false = plaintext
 *     then STARTTLS upgrade, e.g. port 587 — default false)
 *   username?: string (SMTP auth username; often an email address, not treated as secret)
 *   fromAddress: string (required)
 *   rejectUnauthorized?: boolean (default true — set false only for a
 *     deliberately self-signed test server, never in production settings)
 *
 * Secret (credentials_secret_ref, resolved via ProviderFactory): the SMTP
 * AUTH LOGIN password. Only AUTH LOGIN is implemented — it is the most
 * broadly supported mechanism; AUTH PLAIN/XOAUTH2 are not implemented.
 *
 * status() cannot report real delivery state: SMTP is fire-and-forget at the
 * protocol level. Delivery/bounce confirmation would require DSN or bounce
 * webhook handling (see communication_webhooks — schema only, no receiver
 * built yet). status() says so rather than fabricating a status.
 */

import { connect as tcpConnect, Socket } from "net";
import { connect as tlsConnect, TLSSocket } from "tls";
import type {
  AdapterHealthResult,
  AdapterSendResult,
  AdapterStatusResult,
  AdapterValidationResult,
  ProviderAdapter,
  OutboundMessage,
  ResolvedProviderConfig,
} from "../types.js";
import {
  CommunicationValidationError,
  encodeHeaderValue,
  normalizeToCrlf,
  validateEmailAddress,
  validateSmtpHost,
  validateSmtpPort,
  validateSubject,
} from "../validation.js";

const DEFAULT_PORT = 587;
const SOCKET_TIMEOUT_MS = 15000;

interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  username?: string;
  fromAddress: string;
  rejectUnauthorized: boolean;
}

/**
 * Returns null when host/from are absent (caller reports "missing settings").
 * Throws CommunicationValidationError when they are present but unsafe — these
 * values are written into SMTP commands, so they are validated, never trusted.
 */
function parseSettings(settings: Record<string, unknown>): SmtpSettings | null {
  const host = settings.host as string | undefined;
  const fromAddress = (settings.fromAddress as string) || (settings.from_address as string);
  if (!host || !fromAddress) return null;
  const rawPort = settings.port;
  return {
    host: validateSmtpHost(host),
    port: rawPort === undefined || rawPort === null || rawPort === "" ? DEFAULT_PORT : validateSmtpPort(rawPort),
    secure: Boolean(settings.secure),
    username: settings.username as string | undefined,
    fromAddress: validateEmailAddress(fromAddress, "settings.fromAddress"),
    rejectUnauthorized: settings.rejectUnauthorized !== false,
  };
}

/** Minimal line-based SMTP client. One connection per call — no pooling. */
class SmtpSession {
  private socket: Socket | TLSSocket;
  private buffer = "";
  private lineWaiters: Array<{ resolve: (lines: string[]) => void; reject: (err: Error) => void }> = [];

  private constructor(socket: Socket | TLSSocket) {
    this.socket = socket;
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk: string) => this.onData(chunk));
    // Without this, an ECONNRESET (or any post-connect socket error — the
    // remote closing abruptly, a network drop mid-transaction) is an
    // unhandled 'error' event and crashes the whole Node process, not just
    // this send attempt. Caught via a local mock-server test during this
    // change; reject whichever command is currently awaited instead.
    this.socket.on("error", (err: Error) => this.failPendingWaiters(err));
  }

  private failPendingWaiters(err: Error): void {
    const waiters = this.lineWaiters.splice(0, this.lineWaiters.length);
    for (const waiter of waiters) waiter.reject(err);
  }

  static async connect(host: string, port: number, secure: boolean, rejectUnauthorized: boolean): Promise<SmtpSession> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      const raw = secure
        ? tlsConnect({ host, port, rejectUnauthorized })
        : tcpConnect({ host, port });
      raw.setTimeout(SOCKET_TIMEOUT_MS, () => raw.destroy(new Error("SMTP socket timed out.")));
      raw.once("error", onError);
      raw.once("connect", () => {
        raw.removeListener("error", onError);
        resolve(new SmtpSession(raw));
      });
    });
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    while (true) {
      const idx = this.buffer.indexOf("\r\n");
      if (idx === -1) return;
      // A multi-line SMTP response has continuation lines like "250-..." and
      // a final line "250 ..."; wait until we have a full block before resolving.
      const block = this.buffer;
      const lines = block.split("\r\n").filter((l) => l.length > 0 || block.endsWith("\r\n"));
      const complete = this.isCompleteResponse(lines);
      if (!complete) return; // wait for more data
      // Consume exactly the lines that formed this response.
      const consumedLen = lines.slice(0, this.responseLineCount(lines)).join("\r\n").length + 2;
      this.buffer = this.buffer.slice(consumedLen);
      const waiter = this.lineWaiters.shift();
      if (waiter) waiter.resolve(lines.slice(0, this.responseLineCount(lines)));
      if (this.buffer.length === 0) return;
    }
  }

  private responseLineCount(lines: string[]): number {
    let count = 0;
    for (const line of lines) {
      count++;
      if (/^\d{3} /.test(line)) break; // final line: code followed by space (not '-')
      if (line === "") break;
    }
    return count;
  }

  private isCompleteResponse(lines: string[]): boolean {
    for (const line of lines) {
      if (/^\d{3} /.test(line)) return true;
    }
    return false;
  }

  private readResponse(): Promise<{ code: number; text: string; lines: string[] }> {
    return new Promise((resolve, reject) => {
      this.lineWaiters.push({
        resolve: (lines) => {
          const last = lines[lines.length - 1] || "";
          const code = parseInt(last.slice(0, 3), 10);
          resolve({ code, text: lines.join("\n"), lines });
        },
        reject,
      });
    });
  }

  async expectGreeting(): Promise<{ code: number; text: string }> {
    return this.readResponse();
  }

  async command(cmd: string): Promise<{ code: number; text: string; lines: string[] }> {
    this.socket.write(cmd + "\r\n");
    return this.readResponse();
  }

  /** Dot-stuffs the body per RFC 5321 §4.5.2 and sends the terminating CRLF.CRLF. */
  async sendData(headers: string, body: string): Promise<{ code: number; text: string }> {
    // Normalize first (a bare CR or LF is a smuggling vector), then dot-stuff every line.
    const stuffed = normalizeToCrlf(body).replace(/^\./gm, "..");
    this.socket.write(headers + "\r\n\r\n" + stuffed + "\r\n.\r\n");
    return this.readResponse();
  }

  upgradeToTLS(host: string, rejectUnauthorized: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const plainSocket = this.socket as Socket;
      plainSocket.removeAllListeners("data");
      const tlsSocket = tlsConnect({ socket: plainSocket, host, rejectUnauthorized }, () => {
        this.socket = tlsSocket;
        this.socket.setEncoding("utf8");
        this.socket.on("data", (chunk: string) => this.onData(chunk));
        this.socket.on("error", (err: Error) => this.failPendingWaiters(err));
        resolve();
      });
      tlsSocket.once("error", reject);
    });
  }

  private closed = false;

  /** Writes QUIT and ends the socket gracefully (FIN, not RST) — a forceful
   *  destroy() immediately after write() can race the flush and reset the
   *  connection instead of closing it cleanly. */
  quit(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.end("QUIT\r\n");
    } catch {
      // best-effort
    }
  }

  /** Idempotent — safe to call after quit() (e.g. from a finally block) without double-acting. */
  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
  }
}

async function withSession<T>(cfg: SmtpSettings, fn: (s: SmtpSession) => Promise<T>): Promise<T> {
  const session = await SmtpSession.connect(cfg.host, cfg.port, cfg.secure, cfg.rejectUnauthorized);
  try {
    return await fn(session);
  } finally {
    session.destroy();
  }
}

async function authenticate(session: SmtpSession, username: string, password: string): Promise<void> {
  const start = await session.command("AUTH LOGIN");
  if (start.code !== 334) throw new Error(`AUTH LOGIN rejected: ${start.text}`);
  const userStep = await session.command(Buffer.from(username, "utf8").toString("base64"));
  if (userStep.code !== 334) throw new Error(`AUTH LOGIN username step failed: ${userStep.text}`);
  const passStep = await session.command(Buffer.from(password, "utf8").toString("base64"));
  if (passStep.code !== 235) throw new Error(`AUTH LOGIN authentication failed: ${passStep.text}`);
}

async function ehloAndMaybeStartTls(session: SmtpSession, cfg: SmtpSettings): Promise<void> {
  await session.expectGreeting();
  const ehlo1 = await session.command(`EHLO bell24h-os`);
  if (ehlo1.code !== 250) throw new Error(`EHLO rejected: ${ehlo1.text}`);

  if (!cfg.secure && ehlo1.lines.some((l) => /STARTTLS/i.test(l))) {
    const startTls = await session.command("STARTTLS");
    if (startTls.code !== 220) throw new Error(`STARTTLS rejected: ${startTls.text}`);
    await session.upgradeToTLS(cfg.host, cfg.rejectUnauthorized);
    const ehlo2 = await session.command(`EHLO bell24h-os`);
    if (ehlo2.code !== 250) throw new Error(`EHLO after STARTTLS rejected: ${ehlo2.text}`);
  }
}

export class SMTPProvider implements ProviderAdapter {
  readonly provider = "smtp";
  readonly channelType = "email" as const;

  async send(message: OutboundMessage, config: ResolvedProviderConfig): Promise<AdapterSendResult> {
    let parsed: SmtpSettings | null;
    let recipient: string;
    let subject: string;
    try {
      parsed = parseSettings(config.settings);
      // Validated BEFORE any socket is opened: recipient and subject are written verbatim
      // into RCPT TO / To: / Subject:, so a CR or LF in either is command/header injection.
      recipient = validateEmailAddress(message.recipient);
      subject = validateSubject(message.subject) ?? "(no subject)";
    } catch (err: any) {
      if (err instanceof CommunicationValidationError) return { success: false, errorMessage: err.message };
      throw err;
    }
    if (!parsed) return { success: false, errorMessage: "Provider settings missing 'host' or 'fromAddress'." };
    if (!config.secretValue) return { success: false, errorMessage: "Missing resolved SMTP password secret." };
    const cfg = parsed;

    try {
      return await withSession(cfg, async (session) => {
        await ehloAndMaybeStartTls(session, cfg);
        if (cfg.username) await authenticate(session, cfg.username, config.secretValue);

        const mailFrom = await session.command(`MAIL FROM:<${cfg.fromAddress}>`);
        if (mailFrom.code !== 250) return fail(`MAIL FROM rejected: ${mailFrom.text}`);

        const rcptTo = await session.command(`RCPT TO:<${recipient}>`);
        if (rcptTo.code !== 250 && rcptTo.code !== 251) return fail(`RCPT TO rejected: ${rcptTo.text}`);

        const dataStart = await session.command("DATA");
        if (dataStart.code !== 354) return fail(`DATA rejected: ${dataStart.text}`);

        const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@bell24h-os>`;
        const headers = [
          `From: ${cfg.fromAddress}`,
          `To: ${recipient}`,
          `Subject: ${encodeHeaderValue(subject)}`,
          `Date: ${new Date().toUTCString()}`,
          `Message-ID: ${messageId}`,
          `MIME-Version: 1.0`,
          `Content-Type: text/html; charset=utf-8`,
        ].join("\r\n");

        const dataEnd = await session.sendData(headers, message.body);
        if (dataEnd.code !== 250) return fail(`Message rejected after DATA: ${dataEnd.text}`);

        session.quit();
        return { success: true, providerMessageId: messageId, raw: { finalResponse: dataEnd.text } };
      });
    } catch (err: any) {
      return { success: false, errorMessage: err?.message || "SMTP session error." };
    }

    function fail(msg: string): AdapterSendResult {
      return { success: false, errorMessage: msg };
    }
  }

  async status(_providerMessageId: string, _config: ResolvedProviderConfig): Promise<AdapterStatusResult> {
    // SMTP is fire-and-forget at the protocol level. Real delivery/bounce
    // status requires DSN or bounce-webhook handling, not implemented here —
    // see communication_webhooks (schema only, no receiver yet).
    return {
      status: "sent",
      raw: { note: "SMTP has no native status query; delivery confirmation is not implemented." },
    };
  }

  async validate(config: ResolvedProviderConfig): Promise<AdapterValidationResult> {
    let cfg: SmtpSettings | null;
    try {
      cfg = parseSettings(config.settings);
    } catch (err: any) {
      return { valid: false, reason: err?.message || "Invalid provider settings." };
    }
    if (!cfg) return { valid: false, reason: "Provider settings missing 'host' or 'fromAddress'." };
    if (cfg.username && !config.secretValue) {
      return { valid: false, reason: "Username configured but no password secret resolved." };
    }
    return { valid: true };
  }

  /** Connects, EHLOs, STARTTLS-upgrades if offered, and authenticates if a username is set — sends no mail. */
  async healthCheck(config: ResolvedProviderConfig): Promise<AdapterHealthResult> {
    const checkedAt = new Date().toISOString();
    let cfg: SmtpSettings | null;
    try {
      cfg = parseSettings(config.settings);
    } catch (err: any) {
      return { healthy: false, detail: err?.message || "Invalid provider settings.", checkedAt };
    }
    if (!cfg) return { healthy: false, detail: "Provider settings missing 'host' or 'fromAddress'.", checkedAt };
    const smtp = cfg;

    try {
      await withSession(smtp, async (session) => {
        await ehloAndMaybeStartTls(session, smtp);
        if (smtp.username) await authenticate(session, smtp.username, config.secretValue);
        session.quit();
      });
      return { healthy: true, checkedAt };
    } catch (err: any) {
      return { healthy: false, detail: err?.message || "SMTP connection/auth failed.", checkedAt };
    }
  }
}
