/**
 * Scheduler certification (CH-02): decides, from EVIDENCE, whether the InsForge schedule that drives the
 * communication worker is actually working. It defaults to NOT CERTIFIED and only says CERTIFIED when every
 * check below has evidence. It never creates a schedule, never calls the worker, never prints a header value.
 *
 *   npx tsx scripts/certify-scheduler.ts [--app-url https://<production-host>] [--json]
 *
 * Evidence used:
 *   1. `insforge schedules list --json`           — a schedule exists, is active, targets GET .../api/v1/workers/tick
 *      with an Authorization header
 *   2. `insforge schedules logs <id> --json`      — enough recent runs, all answered with HTTP 2xx
 *   3. (optional) `--app-url`: an UNAUTHENTICATED GET of the tick route must be refused (401/403). That proves the
 *      route exists and fails closed. It does not run the worker (no credential is sent).
 *
 * Exit code: 0 = CERTIFIED, 1 = NOT CERTIFIED (with the reasons), 2 = the checker itself could not run.
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const TICK_PATH = "/api/v1/workers/tick";
export const MIN_SUCCESSFUL_RUNS = 3;
export const MAX_STALE_MS = 24 * 3600_000;

export type Verdict = "CERTIFIED" | "NOT CERTIFIED";
export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
export interface Report {
  verdict: Verdict;
  checks: Check[];
  schedule?: { id: string; name: string; cron: string };
}

type Json = Record<string, unknown>;
const str = (o: Json, ...keys: string[]): string | undefined => {
  for (const k of keys) if (typeof o[k] === "string" && (o[k] as string) !== "") return o[k] as string;
  return undefined;
};
const bool = (o: Json, ...keys: string[]): boolean | undefined => {
  for (const k of keys) if (typeof o[k] === "boolean") return o[k] as boolean;
  return undefined;
};
const num = (o: Json, ...keys: string[]): number | undefined => {
  for (const k of keys) if (typeof o[k] === "number") return o[k] as number;
  return undefined;
};

/** The HTTP status a log row reports, or undefined when the row does not say (which is NOT treated as success). */
export function logStatus(row: Json): number | undefined {
  const n = num(row, "statusCode", "status_code", "httpStatus", "http_status", "responseStatus", "response_status");
  if (n !== undefined) return n;
  const s = str(row, "statusCode", "status_code", "httpStatus", "status");
  const parsed = s !== undefined ? Number(s) : NaN;
  return Number.isInteger(parsed) ? parsed : undefined;
}

export function logTime(row: Json): number | undefined {
  const s = str(row, "executedAt", "executed_at", "createdAt", "created_at", "startedAt", "started_at", "timestamp");
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? undefined : t;
}

const asArray = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : v && typeof v === "object" && Array.isArray((v as Json).schedules) ? ((v as Json).schedules as Json[]) : v && typeof v === "object" && Array.isArray((v as Json).logs) ? ((v as Json).logs as Json[]) : []);

/** Pure decision: no I/O, so it is unit-tested with fixtures (server/communication/__tests__/certifyScheduler.test.ts). */
export function evaluate(input: { schedules: unknown; logs: unknown | null; tickProbeStatus?: number | null; now?: Date }): Report {
  const now = (input.now ?? new Date()).getTime();
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const all = asArray(input.schedules);
  const candidates = all.filter((s) => (str(s, "url", "functionUrl", "function_url", "targetUrl") ?? "").includes(TICK_PATH));
  add("a schedule targeting the worker tick exists", candidates.length > 0, candidates.length > 0 ? `${candidates.length} found` : `no schedule points at ${TICK_PATH} (${all.length} schedule(s) exist in total)`);
  if (candidates.length === 0) return { verdict: "NOT CERTIFIED", checks };

  const s = candidates[0];
  const id = str(s, "id", "scheduleId", "schedule_id") ?? "";
  const cron = str(s, "cronSchedule", "cron_schedule", "cron", "schedule") ?? "?";
  const url = str(s, "url", "functionUrl", "function_url", "targetUrl") ?? "";
  const method = (str(s, "method", "httpMethod", "http_method") ?? "").toUpperCase();
  const active = bool(s, "isActive", "is_active", "active", "enabled");
  const headers = (s.headers ?? s.httpHeaders ?? null) as Json | null;

  add("schedule is active", active === true, active === undefined ? "the CLI output did not say (treated as NOT active)" : String(active));
  add("method is GET (the route only accepts GET)", method === "GET", method || "not reported");
  add("target is https", /^https:\/\//i.test(url), url ? url.replace(/\?.*$/, "") : "no url");
  add(
    "an Authorization header is configured",
    !!headers && typeof headers === "object" && Object.keys(headers).some((k) => k.toLowerCase() === "authorization"),
    "value never printed",
  );

  const rows = input.logs === null ? null : asArray(input.logs);
  if (rows === null) {
    add("execution logs are available", false, "could not read `schedules logs`");
  } else {
    const dated = rows.map((r) => ({ status: logStatus(r), at: logTime(r) })).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    const unreadable = dated.filter((r) => r.status === undefined).length;
    const recent = dated.slice(0, 10);
    const ok = recent.filter((r) => r.status !== undefined && r.status >= 200 && r.status < 300);
    const bad = recent.filter((r) => r.status === undefined || r.status < 200 || r.status >= 300);
    add(`at least ${MIN_SUCCESSFUL_RUNS} runs answered HTTP 2xx`, ok.length >= MIN_SUCCESSFUL_RUNS, `${ok.length} of the last ${recent.length} run(s)${rows.length === 0 ? " — the schedule has never run" : ""}`);
    add("none of the last 10 runs failed", bad.length === 0 && rows.length > 0, bad.length ? `${bad.length} non-2xx or unreadable (${unreadable} without a status)` : rows.length === 0 ? "no runs" : "all 2xx");
    const newest = dated[0]?.at;
    add("the newest run is recent", newest !== undefined && now - newest <= MAX_STALE_MS, newest === undefined ? "no timestamp" : `${Math.round((now - newest) / 60000)} minute(s) ago`);
  }

  if (input.tickProbeStatus !== undefined) {
    const st = input.tickProbeStatus;
    add("an unauthenticated call to the tick route is refused (fails closed)", st === 401 || st === 403, st === null ? "the request did not complete" : `HTTP ${st}`);
  }

  return { verdict: checks.every((c) => c.ok) ? "CERTIFIED" : "NOT CERTIFIED", checks, schedule: { id, name: str(s, "name") ?? "", cron } };
}

// ---- CLI plumbing (not unit-tested; it only shells out and parses) -----------------------------------------------

function cli(args: string[]): { ok: boolean; json: unknown; raw: string } {
  const r = spawnSync(`npx -y @insforge/cli ${args.join(" ")}`, { shell: true, encoding: "utf8", timeout: 120_000 });
  const raw = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status !== 0) return { ok: false, json: null, raw };
  const start = Math.min(...["[", "{"].map((c) => (r.stdout.indexOf(c) === -1 ? Infinity : r.stdout.indexOf(c))));
  try {
    return { ok: true, json: JSON.parse(r.stdout.slice(start)), raw };
  } catch {
    return { ok: false, json: null, raw };
  }
}

async function probeTick(appUrl: string): Promise<number | null> {
  try {
    const res = await fetch(new URL(TICK_PATH, appUrl), { method: "GET", signal: AbortSignal.timeout(15_000) });
    return res.status;
  } catch {
    return null;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const ai = argv.indexOf("--app-url");
  const appUrl = ai >= 0 ? argv[ai + 1] : undefined;

  const list = cli(["schedules", "list", "--json"]);
  if (!list.ok) {
    console.error("Could not run `insforge schedules list` (not logged in / not linked?).\n" + list.raw.slice(0, 400));
    process.exit(2);
  }
  const candidates = asArray(list.json).filter((s) => (str(s, "url", "functionUrl", "function_url", "targetUrl") ?? "").includes(TICK_PATH));
  let logs: unknown | null = [];
  if (candidates.length > 0) {
    const id = str(candidates[0], "id", "scheduleId", "schedule_id");
    const r = id ? cli(["schedules", "logs", id, "--limit", "50", "--json"]) : { ok: false, json: null, raw: "" };
    logs = r.ok ? r.json : null;
  }
  const probe = appUrl ? await probeTick(appUrl) : undefined;
  const report = evaluate({ schedules: list.json, logs, tickProbeStatus: probe });

  if (asJson) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Scheduler certification: ${report.verdict}`);
    for (const c of report.checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name} — ${c.detail}`);
    if (!appUrl) console.log("  (no --app-url given: the fail-closed probe of the tick route was not run)");
    if (report.verdict !== "CERTIFIED") console.log("\nNot certified. Nothing here is a claim that the scheduler works. See docs/project/CH02_INSFORGE_WORKER_SCHEDULE_RUNBOOK.md.");
  }
  process.exit(report.verdict === "CERTIFIED" ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
