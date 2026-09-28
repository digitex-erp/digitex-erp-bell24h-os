/**
 * Runs the REAL add_communication_hub.sql on a real Postgres engine and asserts the security
 * properties the hardening depends on: tenants cannot write provider/message rows, and
 * (organization_id, idempotency_key) is unique.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { campaignsMigrationSql, communicationMigrationSql, createTestDb, seedOrg, seedUser, type TestDb } from "./helpers/testDb.js";

let t: TestDb;
let orgA: string;
let userA: string;

before(async () => {
  t = await createTestDb();
  orgA = await seedOrg(t.db, "A");
  userA = await seedUser(t.db, orgA, ["MANAGER"]);
});
after(async () => {
  await t.db.close();
});

const priv = async (role: string, table: string, p: string) =>
  (await t.db.query<{ ok: boolean }>(`SELECT has_table_privilege($1, $2, $3) AS ok`, [role, `public.${table}`, p])).rows[0].ok;

/** Runs `fn` as a tenant: SET ROLE + the JWT claim that auth.uid() reads. */
async function asTenant<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await t.db.exec(`SET ROLE authenticated`);
  await t.db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  try {
    return await fn();
  } finally {
    await t.db.exec(`RESET ROLE`);
    await t.db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
}

describe("migration applies and is re-runnable", () => {
  it("creates the six foundation tables", async () => {
    const names = ["communication_providers", "communication_templates", "communication_campaigns", "communication_messages", "communication_deliveries", "communication_webhooks"];
    const r = await t.db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name = ANY($1)`,
      [names],
    );
    assert.equal(r.rows[0].n, 6);
  });

  it("can be applied a second time without error (policies are dropped and recreated)", async () => {
    await t.db.exec(communicationMigrationSql());
    await t.db.exec(campaignsMigrationSql());
    const r = await t.db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM pg_policies WHERE tablename='communication_messages'`);
    assert.equal(r.rows[0].n, 1, "exactly one (SELECT) policy after a re-run, not duplicates");
  });
});

describe("B1 — tenants cannot touch communication_providers", () => {
  it("has no policies at all (default-deny) and no privileges for anon/authenticated", async () => {
    const pol = await t.db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM pg_policies WHERE tablename='communication_providers'`);
    assert.equal(pol.rows[0].n, 0);
    for (const role of ["anon", "authenticated"]) {
      for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        assert.equal(await priv(role, "communication_providers", p), false, `${role} ${p}`);
      }
    }
  });

  it("the original exploit is blocked: a tenant INSERT of a provider row is denied by the database", async () => {
    await assert.rejects(
      asTenant(userA, () =>
        t.db.query(
          `INSERT INTO public.communication_providers (organization_id, name, provider, channel_type, credentials_secret_ref, settings)
           VALUES ($1, 'evil', 'smtp', 'email', 'SMTP_PASSWORD', '{"host":"evil.example.com","fromAddress":"a@b.com"}')`,
          [orgA],
        ),
      ),
      (err: { code?: string }) => err.code === "42501",
    );
  });

  it("a tenant cannot even read provider rows (secret names stay server-side)", async () => {
    await t.db.query(
      `INSERT INTO public.communication_providers (organization_id, name, provider, channel_type, credentials_secret_ref)
       VALUES ($1, 'primary', 'resend', 'email', 'RESEND_API_KEY')`,
      [orgA],
    );
    await assert.rejects(asTenant(userA, () => t.db.query(`SELECT * FROM public.communication_providers`)), (e: { code?: string }) => e.code === "42501");
  });
});

describe("B3 — tenants cannot bypass the API's controls by writing rows directly", () => {
  it("messages / campaigns / deliveries / webhooks: tenant privileges are read-only", async () => {
    for (const table of ["communication_messages", "communication_campaigns", "communication_deliveries", "communication_webhooks"]) {
      assert.equal(await priv("authenticated", table, "SELECT"), true, `${table} SELECT`);
      for (const p of ["INSERT", "UPDATE", "DELETE"]) assert.equal(await priv("authenticated", table, p), false, `${table} ${p}`);
    }
  });

  it("a direct tenant INSERT into communication_messages is denied", async () => {
    await assert.rejects(
      asTenant(userA, () =>
        t.db.query(`INSERT INTO public.communication_messages (organization_id, channel_type, recipient, body) VALUES ($1,'email','a@example.com','x')`, [orgA]),
      ),
      (e: { code?: string }) => e.code === "42501",
    );
  });

  it("tenants keep org-scoped READ on messages; other orgs' rows are invisible (RLS)", async () => {
    const orgB = await seedOrg(t.db, "B");
    await t.db.query(`INSERT INTO public.communication_messages (organization_id, channel_type, recipient, body) VALUES ($1,'email','a@example.com','mine')`, [orgA]);
    await t.db.query(`INSERT INTO public.communication_messages (organization_id, channel_type, recipient, body) VALUES ($1,'email','b@example.com','theirs')`, [orgB]);
    const rows = await asTenant(userA, async () => (await t.db.query<{ body: string }>(`SELECT body FROM public.communication_messages`)).rows);
    assert.deepEqual(rows.map((r) => r.body), ["mine"]);
  });

  it("templates remain tenant-writable, org-scoped (no outbound effect)", async () => {
    assert.equal(await priv("authenticated", "communication_templates", "INSERT"), true);
    await asTenant(userA, () =>
      t.db.query(`INSERT INTO public.communication_templates (organization_id, name, channel_type, body) VALUES ($1,'t','email','hi')`, [orgA]),
    );
    const orgB = await seedOrg(t.db, "B2");
    await assert.rejects(
      asTenant(userA, () =>
        t.db.query(`INSERT INTO public.communication_templates (organization_id, name, channel_type, body) VALUES ($1,'t','email','hi')`, [orgB]),
      ),
      (e: { code?: string }) => e.code === "42501",
      "RLS WITH CHECK must reject writing into another org",
    );
  });
});

describe("B3 — idempotency uniqueness is enforced by the database", () => {
  it("same (org, key) twice -> unique violation on the idempotency index; same key in another org is fine; NULL keys never collide", async () => {
    const orgB = await seedOrg(t.db, "B3");
    const ins = (org: string, key: string | null) =>
      t.db.query(`INSERT INTO public.communication_messages (organization_id, channel_type, recipient, body, idempotency_key) VALUES ($1,'email','a@example.com','x',$2)`, [org, key]);

    await ins(orgA, "unique-key-0001");
    await assert.rejects(ins(orgA, "unique-key-0001"), (e: { code?: string; constraint?: string }) => {
      return e.code === "23505" && String(e.constraint).includes("idempotency");
    });
    await ins(orgB, "unique-key-0001");
    await ins(orgA, null);
    await ins(orgA, null);
  });
});
