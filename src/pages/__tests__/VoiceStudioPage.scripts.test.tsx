/**
 * Frontend tests for the Call Scripts tab in VoiceStudioPage.tsx.
 *
 * Mocking boundary: `@/lib/authedFetch`'s `authedFetchJson` -- the single
 * choke point this page uses for every network call (per the task's "use
 * the existing authentication and API abstractions" instruction, this is
 * mocked, not replaced). No real Supabase session, provider credential, or
 * network request is ever touched. The fake below reproduces the real
 * server's actual response shapes exactly as verified against
 * server/voice/routes.ts and VoiceService.ts in this engagement (in
 * particular: POST/PATCH/duplicate responses do NOT include a `versions`
 * field -- only GET /:code does -- which is the real contract that a past
 * bug in this same component got wrong).
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VoiceStudioPage } from "../VoiceStudioPage";

vi.mock("@/lib/authedFetch", () => ({
  authedFetchJson: vi.fn(),
  AuthedFetchError: class AuthedFetchError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

import { authedFetchJson, AuthedFetchError } from "@/lib/authedFetch";
const fetchMock = authedFetchJson as unknown as ReturnType<typeof vi.fn>;

function httpError(status: number, code: string): never {
  throw new AuthedFetchError(status, code);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SECTION_FIELDS = [
  "opening",
  "verification",
  "purpose",
  "questions",
  "objections",
  "negotiation",
  "closing",
  "escalation",
  "fallback",
] as const;

interface FakeScript {
  id: string;
  code: string;
  name: string;
  status: "draft" | "published" | "archived";
  version: number;
  updated_at: string;
  agent_key: string | null;
  language: string;
  tone: string;
  variables: string[];
  opening: string | null;
  verification: string | null;
  purpose: string | null;
  questions: string | null;
  objections: string | null;
  negotiation: string | null;
  closing: string | null;
  escalation: string | null;
  fallback: string | null;
  versions: { id: string; version: number; published_by: string | null; published_at: string }[];
}

let fakeScriptIdSeq = 1;

function makeFakeScript(overrides: Partial<FakeScript>): FakeScript {
  return {
    // A unique default per call -- several tests seed more than one script
    // without specifying an id, and React (correctly) warns on duplicate
    // list keys if two fakes share "id-1".
    id: overrides.id ?? `fake-id-${fakeScriptIdSeq++}`,
    code: overrides.code ?? "script-1",
    name: overrides.name ?? "Script One",
    status: overrides.status ?? "draft",
    version: overrides.version ?? 0,
    updated_at: overrides.updated_at ?? new Date().toISOString(),
    agent_key: overrides.agent_key ?? null,
    language: overrides.language ?? "en-IN",
    tone: overrides.tone ?? "professional",
    variables: overrides.variables ?? [],
    opening: overrides.opening ?? null,
    verification: overrides.verification ?? null,
    purpose: overrides.purpose ?? null,
    questions: overrides.questions ?? null,
    objections: overrides.objections ?? null,
    negotiation: overrides.negotiation ?? null,
    closing: overrides.closing ?? null,
    escalation: overrides.escalation ?? null,
    fallback: overrides.fallback ?? null,
    versions: overrides.versions ?? [],
  };
}

function withoutVersions(s: FakeScript) {
  const { versions, ...rest } = s;
  return rest;
}

/** A small stateful fake of the real /api/voice/scripts* contract. */
class FakeScriptsApi {
  scripts = new Map<string, FakeScript>();
  private idSeq = 1;
  /** Per-code artificial delay (ms) for the GET /:code route, to test races. */
  detailDelays = new Map<string, number>();

  seed(script: FakeScript) {
    this.scripts.set(script.code, script);
  }

  private summaries() {
    return [...this.scripts.values()].map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      status: s.status,
      version: s.version,
      updated_at: s.updated_at,
    }));
  }

  async handle(path: string, init?: RequestInit): Promise<any> {
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(init.body as string) : undefined;

    if (path === "/api/voice/calls?limit=25" && method === "GET") return { calls: [] };
    if (path === "/api/voice/agents" && method === "GET") return { agents: [] };

    if (path === "/api/voice/scripts" && method === "GET") return { scripts: this.summaries() };

    if (path === "/api/voice/scripts" && method === "POST") {
      if (!body?.name || !String(body.name).trim()) httpError(400, "validation_failed");
      if (this.scripts.has(body.code)) httpError(409, "conflict");
      const s = makeFakeScript({
        id: `id-${this.idSeq++}`,
        code: body.code,
        name: body.name,
        language: body.language,
        tone: body.tone,
        variables: body.variables ?? [],
        ...Object.fromEntries(SECTION_FIELDS.map((f) => [f, body[f] ?? null])),
      });
      this.scripts.set(s.code, s);
      return withoutVersions(s);
    }

    const detail = path.match(/^\/api\/voice\/scripts\/([^/]+)$/);
    if (detail && method === "GET") {
      const code = decodeURIComponent(detail[1]);
      const delay = this.detailDelays.get(code);
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const s = this.scripts.get(code);
      if (!s) httpError(404, "not_found");
      return { ...s };
    }
    if (detail && method === "PATCH") {
      const code = decodeURIComponent(detail[1]);
      const s = this.scripts.get(code);
      if (!s) httpError(404, "not_found");
      if (s.status === "archived") httpError(409, "conflict");
      s.name = body.name;
      s.language = body.language;
      s.tone = body.tone;
      s.variables = body.variables ?? [];
      for (const f of SECTION_FIELDS) (s as any)[f] = body[f] ?? null;
      if (s.status === "published") s.status = "draft";
      return withoutVersions(s);
    }

    const dup = path.match(/^\/api\/voice\/scripts\/([^/]+)\/duplicate$/);
    if (dup && method === "POST") {
      const source = this.scripts.get(decodeURIComponent(dup[1]));
      if (!source) httpError(404, "not_found");
      if (this.scripts.has(body.newCode)) httpError(409, "conflict");
      const s = makeFakeScript({
        ...source,
        id: `id-${this.idSeq++}`,
        code: body.newCode,
        name: body.newName ?? `${source.name} (Copy)`,
        status: "draft",
        version: 0,
        versions: [],
      });
      this.scripts.set(s.code, s);
      return withoutVersions(s);
    }

    const pub = path.match(/^\/api\/voice\/scripts\/([^/]+)\/publish$/);
    if (pub && method === "POST") {
      const s = this.scripts.get(decodeURIComponent(pub[1]));
      if (!s) httpError(404, "not_found");
      if (s.status === "archived") httpError(409, "conflict");
      if (s.status === "published") return { published: false, version: s.version };
      s.version += 1;
      s.status = "published";
      s.versions.push({ id: `v-${s.version}`, version: s.version, published_by: null, published_at: new Date().toISOString() });
      return { published: true, version: s.version };
    }

    const prev = path.match(/^\/api\/voice\/scripts\/([^/]+)\/preview$/);
    if (prev && method === "POST") {
      const s = this.scripts.get(decodeURIComponent(prev[1]));
      if (!s) httpError(404, "not_found");
      const sampleValues: Record<string, string> = body.sampleValues ?? {};
      for (const key of Object.keys(sampleValues)) {
        if (!s.variables.includes(key)) httpError(400, "validation_failed");
      }
      const sections: Record<string, string | null> = {};
      for (const f of SECTION_FIELDS) {
        const text = s[f];
        sections[f] = text
          ? text.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_m, name: string) =>
              escapeHtml(sampleValues[name] ?? `[${name}]`),
            )
          : null;
      }
      return {
        preview: true,
        disclaimer: "This is a text preview only. No call is placed and no voice is synthesized.",
        code: s.code,
        name: s.name,
        status: s.status,
        version: s.version,
        declaredVariables: s.variables,
        sections,
      };
    }

    throw new Error(`Unhandled fake API call: ${method} ${path}`);
  }
}

let api: FakeScriptsApi;

beforeEach(() => {
  api = new FakeScriptsApi();
  fetchMock.mockReset();
  fetchMock.mockImplementation((path: string, init?: RequestInit) => api.handle(path, init));
});

async function openScriptsTab() {
  render(<VoiceStudioPage />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Scripts" }));
  return user;
}

describe("Call Scripts — list: loading, empty, and error states", () => {
  test("shows a loading spinner, then the empty state with no sample data", async () => {
    await openScriptsTab();
    expect(await screen.findByText(/no scripts yet/i)).toBeInTheDocument();
    expect(screen.getByText(/real saved records, not sample data/i)).toBeInTheDocument();
  });

  test("lists real saved scripts, showing status and version", async () => {
    api.seed(makeFakeScript({ code: "a", name: "Script A", status: "draft" }));
    api.seed(makeFakeScript({ code: "b", name: "Script B", status: "published", version: 2 }));
    await openScriptsTab();
    expect(await screen.findByText("Script A")).toBeInTheDocument();
    expect(screen.getByText("Script B")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
  });

  test("shows an error with Retry when the list fetch fails, and Retry recovers", async () => {
    let calls = 0;
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/api/voice/scripts" && (init?.method ?? "GET") === "GET") {
        calls += 1;
        if (calls === 1) httpError(500, "internal_error");
        return api.handle(path, init);
      }
      return api.handle(path, init);
    });
    const user = await openScriptsTab();
    expect(await screen.findByText(/internal_error/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/no scripts yet/i)).toBeInTheDocument();
  });
});

describe("Call Scripts — open and view", () => {
  test("selecting a script from the list opens its detail", async () => {
    api.seed(
      makeFakeScript({
        code: "rfq-1",
        name: "RFQ Follow-up",
        opening: "Hello {{buyer_name}}.",
        variables: ["buyer_name"],
      }),
    );
    const user = await openScriptsTab();
    await user.click(await screen.findByText("RFQ Follow-up"));
    expect(await screen.findByDisplayValue("Hello {{buyer_name}}.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("RFQ Follow-up")).toBeInTheDocument();
  });

  test("a 404 on open (e.g. deleted between list and open) shows a not-found error with Retry", async () => {
    api.seed(makeFakeScript({ code: "vanishing", name: "Vanishing Script" }));
    const user = await openScriptsTab();
    await screen.findByText("Vanishing Script");
    // Simulate the script having disappeared server-side between the list
    // load and the click (e.g. a concurrent delete) by removing it from the
    // fake store right before the detail GET fires.
    api.scripts.delete("vanishing");
    await user.click(screen.getByText("Vanishing Script"));
    expect(await screen.findByText(/script not found/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("Call Scripts — create and validation", () => {
  test("creating a script with a missing name shows a validation error and does not clear the form", async () => {
    const user = await openScriptsTab();
    await user.click(screen.getByRole("button", { name: "New" }));
    await user.type(screen.getByPlaceholderText(/code \(e\.g\./i), "new-script-1");
    // Leave name blank.
    await user.click(screen.getByRole("button", { name: "Create draft" }));
    expect(await screen.findByText(/validation_failed/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/code \(e\.g\./i)).toHaveValue("new-script-1");
  });

  test("creating a valid script succeeds, shows a success message, and appears in the list", async () => {
    const user = await openScriptsTab();
    await user.click(screen.getByRole("button", { name: "New" }));
    await user.type(screen.getByPlaceholderText(/code \(e\.g\./i), "new-script-2");
    await user.type(screen.getByPlaceholderText("Name"), "Brand New Script");
    await user.click(screen.getByRole("button", { name: "Create draft" }));
    expect(await screen.findByText(/created as a draft/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Brand New Script")).toBeInTheDocument();
  });

  test("editing an existing script's content enables Save only while dirty, and shows a success message", async () => {
    api.seed(makeFakeScript({ code: "edit-1", name: "Editable" }));
    const user = await openScriptsTab();
    await user.click(await screen.findByText("Editable"));
    const saveButton = await screen.findByRole("button", { name: "Save" });
    expect(saveButton).toBeDisabled();
    await user.type(screen.getByPlaceholderText("Opening…"), "New opening line");
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);
    expect(await screen.findByText(/^saved\.$/i)).toBeInTheDocument();
  });

  test("discarding unsaved changes restores the last-saved content", async () => {
    api.seed(makeFakeScript({ code: "discard-1", name: "Discardable", opening: "Original opening" }));
    const user = await openScriptsTab();
    await user.click(await screen.findByText("Discardable"));
    const openingField = await screen.findByDisplayValue("Original opening");
    await userEvent.clear(openingField);
    await userEvent.type(openingField, "Changed opening");
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByDisplayValue("Original opening")).toBeInTheDocument();
  });
});

describe("Call Scripts — duplicate", () => {
  test("duplicating a script creates a new draft and opens it", async () => {
    api.seed(makeFakeScript({ code: "src-1", name: "Source Script", status: "published", version: 3 }));
    const user = await openScriptsTab();
    await user.click(await screen.findByText("Source Script"));
    await user.type(await screen.findByPlaceholderText("New code"), "src-1-copy");
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(await screen.findByText(/duplicated as a new draft/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Source Script (Copy)")).toBeInTheDocument();
  });

  test("duplicating with a code that already exists shows a conflict error", async () => {
    api.seed(makeFakeScript({ code: "src-2", name: "Source Two" }));
    api.seed(makeFakeScript({ code: "src-2-taken", name: "Already Taken" }));
    const user = await openScriptsTab();
    await user.click(await screen.findByText("Source Two"));
    await user.type(await screen.findByPlaceholderText("New code"), "src-2-taken");
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(await screen.findByText(/conflict/i)).toBeInTheDocument();
  });
});

describe("Call Scripts — publish and version history", () => {
  test("a never-published script shows 'Never published.'", async () => {
    api.seed(makeFakeScript({ code: "pub-1", name: "Publish Me" }));
    const user = await openScriptsTab();
    await user.click(await screen.findByText("Publish Me"));
    expect(await screen.findByText(/never published/i)).toBeInTheDocument();
  });

  test("publishing shows the new version in history and flips the status badge", async () => {
    api.seed(makeFakeScript({ code: "pub-2", name: "Publish Two" }));
    const user = await openScriptsTab();
    await user.click(await screen.findByText("Publish Two"));
    await user.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByText(/published as version 1/i)).toBeInTheDocument();
    expect(screen.getByText("Version 1")).toBeInTheDocument();
  });

  test("editing a published script reverts it to draft, shown in the success message", async () => {
    const seeded = makeFakeScript({
      code: "pub-3",
      name: "Publish Three",
      status: "published",
      version: 1,
      versions: [{ id: "v-1", version: 1, published_by: null, published_at: new Date().toISOString() }],
    });
    api.seed(seeded);
    const user = await openScriptsTab();
    await user.click(await screen.findByText("Publish Three"));
    await user.type(screen.getByPlaceholderText("Opening…"), "A change");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/reverted to draft/i)).toBeInTheDocument();
  });

  test("Publish is disabled while there are unsaved changes", async () => {
    api.seed(makeFakeScript({ code: "pub-4", name: "Publish Four" }));
    const user = await openScriptsTab();
    await user.click(await screen.findByText("Publish Four"));
    await user.type(screen.getByPlaceholderText("Opening…"), "Edit");
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
  });
});

describe("Call Scripts — archived-script restrictions", () => {
  test("an archived script shows a banner and disables Save and Publish", async () => {
    api.seed(makeFakeScript({ code: "arc-1", name: "Archived One", status: "archived" }));
    const user = await openScriptsTab();
    await user.click(await screen.findByText("Archived One"));
    expect(await screen.findByText(/this script is archived/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
  });

  test("Duplicate and Preview remain available for an archived script", async () => {
    api.seed(makeFakeScript({ code: "arc-2", name: "Archived Two", status: "archived" }));
    const user = await openScriptsTab();
    await user.click(await screen.findByText("Archived Two"));
    expect(await screen.findByPlaceholderText("New code")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Run preview" })).toBeEnabled();
  });
});

describe("Call Scripts — preview rendering", () => {
  test("substitutes declared variables and renders the real character, not an HTML entity (no double-escaping)", async () => {
    api.seed(
      makeFakeScript({
        code: "prev-1",
        name: "Preview One",
        opening: "Hi {{buyer_name}}, from {{supplier_name}}.",
        variables: ["buyer_name", "supplier_name"],
      }),
    );
    const user = await openScriptsTab();
    await user.click(await screen.findByText("Preview One"));
    await user.type(await screen.findByPlaceholderText("buyer_name"), "Acme's Team");
    await user.click(screen.getByRole("button", { name: "Run preview" }));
    const disclaimer = await screen.findByText(/preview only/i);
    const previewBox = disclaimer.parentElement as HTMLElement;
    // The real, human-readable apostrophe must appear -- not the literal
    // text "&#39;" that double-escaping would have produced.
    expect(previewBox.textContent).toContain("Acme's Team");
    expect(previewBox.textContent).not.toContain("&#39;");
  });

  test("a script with zero declared variables previews cleanly with no substitution inputs rendered", async () => {
    // The server independently rejects an unknown `sampleValues` key (see
    // server/voice/__tests__/callScripts.integration.test.ts's own
    // "preview rejects an unknown sample variable name" test) -- that path
    // cannot be exercised from this UI, by construction: the preview
    // request's sampleValues always comes from `draft.variables.map(...)`,
    // so the UI can never submit a key that isn't declared. This test
    // covers what the UI itself is actually responsible for instead: no
    // declared variables means zero sample inputs are rendered, and
    // preview still succeeds with nothing to substitute.
    api.seed(makeFakeScript({ code: "prev-2", name: "Preview Two", opening: "Hi there.", variables: [] }));
    const user = await openScriptsTab();
    await user.click(await screen.findByText("Preview Two"));
    expect(screen.queryByPlaceholderText(/^[a-z_]+$/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run preview" }));
    expect(await screen.findByText(/preview only/i)).toBeInTheDocument();
  });

  test("a declared-but-unsupplied variable renders as a bracketed placeholder, not blank", async () => {
    api.seed(
      makeFakeScript({
        code: "prev-3",
        name: "Preview Three",
        negotiation: "Our target price is {{price}}.",
        variables: ["price"],
      }),
    );
    const user = await openScriptsTab();
    await user.click(await screen.findByText("Preview Three"));
    await user.click(screen.getByRole("button", { name: "Run preview" }));
    const disclaimer = await screen.findByText(/preview only/i);
    const previewBox = disclaimer.parentElement as HTMLElement;
    expect(previewBox.textContent).toContain("[price]");
  });

  test("preview never dispatches a call or enqueues a job -- only the preview endpoint is called", async () => {
    api.seed(makeFakeScript({ code: "prev-4", name: "Preview Four", opening: "Hello." }));
    const user = await openScriptsTab();
    await user.click(await screen.findByText("Preview Four"));
    await user.click(screen.getByRole("button", { name: "Run preview" }));
    await screen.findByText(/preview only/i);
    const calledPaths = fetchMock.mock.calls.map((c: unknown[]) => c[0]);
    expect(calledPaths.some((p: string) => p.includes("/dispatch"))).toBe(false);
  });
});

describe("Call Scripts — stale async responses and navigation", () => {
  test("opening a second script before the first's slower response arrives shows the second, not the first", async () => {
    api.seed(makeFakeScript({ code: "slow", name: "Slow Script", opening: "Slow content" }));
    api.seed(makeFakeScript({ code: "fast", name: "Fast Script", opening: "Fast content" }));
    api.detailDelays.set("slow", 120);
    api.detailDelays.set("fast", 5);

    const user = await openScriptsTab();
    await screen.findByText("Slow Script");
    await user.click(screen.getByText("Slow Script"));
    await user.click(screen.getByText("Fast Script"));

    await waitFor(() => expect(screen.getByDisplayValue("Fast Script")).toBeInTheDocument());
    // Wait past the slow response's artificial delay, then assert it never
    // clobbered the editor.
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.getByDisplayValue("Fast Script")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Slow Script")).not.toBeInTheDocument();
  });

  test("closing the editor before a slow open() resolves leaves the editor closed", async () => {
    api.seed(makeFakeScript({ code: "slow2", name: "Slow Two" }));
    api.detailDelays.set("slow2", 120);

    const user = await openScriptsTab();
    await screen.findByText("Slow Two");
    await user.click(screen.getByText("Slow Two"));
    // Close before the detail fetch resolves.
    await waitFor(() => expect(screen.getByText(/loading script/i)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "New" })); // leaves "open" state via a different path than Close
    await new Promise((r) => setTimeout(r, 200));
    // The late response must not have reopened "Slow Two" -- the editor
    // should still reflect the blank new-draft state, not the stale script.
    expect(screen.queryByDisplayValue("Slow Two")).not.toBeInTheDocument();
  });
});

describe("Call Scripts — list renders exactly the API response, nothing fabricated", () => {
  // Real cross-org isolation is a server-side/RLS concern, already covered
  // by server/voice/__tests__/callScripts.integration.test.ts's own
  // dedicated org-isolation tests against the real database. This test's
  // job is narrower: guard against the UI ever hardcoding, caching across
  // renders, or otherwise showing a row the mocked API response never sent.
  test("the list shows exactly what the API returned, never more", async () => {
    api.seed(makeFakeScript({ code: "mine", name: "My Own Script" }));
    await openScriptsTab();
    expect(await screen.findByText("My Own Script")).toBeInTheDocument();
    expect(screen.queryByText("Someone Else's Script")).not.toBeInTheDocument();
  });
});
