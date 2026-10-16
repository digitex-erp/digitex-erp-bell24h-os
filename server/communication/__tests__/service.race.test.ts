/**
 * The one idempotency path the DB-backed tests cannot reach: two requests carrying the SAME key but
 * DIFFERENT channels take different advisory locks, so both can reach the INSERT and the unique
 * index is the backstop. PGlite is single-connection, so that interleaving is simulated with a
 * client whose INSERT raises exactly what Postgres raises.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { CommunicationService, IdempotencyKeyReuseError } from "../CommunicationService.js";

function fakePool(insertError: unknown) {
  const log: string[] = [];
  let released = 0;
  const client = {
    query: async (text: string) => {
      log.push(text.trim().split(/\s+/).slice(0, 2).join(" "));
      if (/INSERT INTO public\.communication_messages/.test(text)) throw insertError;
      if (/COUNT\(\*\)/.test(text)) return { rows: [{ n: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release: () => {
      released++;
    },
  };
  return { pool: { connect: async () => client, query: async () => ({ rows: [], rowCount: 0 }) } as unknown as pg.Pool, log, released: () => released };
}

const input = {
  organizationId: "00000000-0000-0000-0000-00000000000a",
  channelType: "sms" as const,
  recipient: "+919876543210",
  body: "otp",
  idempotencyKey: "race-key-00000001",
};

describe("idempotency key racing across channels", () => {
  it("a unique violation on the idempotency index becomes IdempotencyKeyReuseError (422), not a 500", async () => {
    const dbErr = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint: "idx_communication_messages_org_idempotency",
    });
    const f = fakePool(dbErr);
    await assert.rejects(new CommunicationService(f.pool).sendMessage(input), IdempotencyKeyReuseError);
    assert.ok(f.log.includes("ROLLBACK"), "transaction must be rolled back");
    assert.equal(f.released(), 1, "connection must be released");
  });

  it("any OTHER database error is not disguised as key reuse", async () => {
    const other = Object.assign(new Error("some other unique violation"), { code: "23505", constraint: "communication_messages_pkey" });
    await assert.rejects(new CommunicationService(fakePool(other).pool).sendMessage(input), (e: Error) => !(e instanceof IdempotencyKeyReuseError) && /other unique violation/.test(e.message));
    const generic = new Error("connection reset");
    await assert.rejects(new CommunicationService(fakePool(generic).pool).sendMessage(input), /connection reset/);
  });
});
