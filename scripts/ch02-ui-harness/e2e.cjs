const { chromium } = require("playwright-core");
const path = require("path");

const BASE = "http://127.0.0.1:4179";
const SHOTS = path.join(__dirname, "shots");
require("fs").mkdirSync(SHOTS, { recursive: true });
let step = 0;
const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push("PAGEERROR " + e.message));
  const shot = async (n) => page.screenshot({ path: path.join(SHOTS, `${String(++step).padStart(2, "0")}-${n}.png`) });
  const get = async (p) => (await fetch(BASE + p)).text();
  const tick = async () => (await get("/__tick")).split("\n")[0];
  const tab = async (name) => page.getByRole("tab", { name }).click();
  const text = async () => page.locator("body").innerText();
  const dialog = () => page.getByRole("dialog").last();

  // ---------------------------------------------------------------- Scenario A: no provider configured
  await get("/__provider?mode=none");
  await page.goto(BASE);
  await page.getByRole("tab", { name: "Dashboard" }).waitFor();
  const tabs = await page.getByRole("tab").allInnerTexts();
  check(
    "tabs are Dashboard, Templates, Audience, Campaigns, Schedules, Analytics, Suppressions, Logs, Providers (in that order)",
    JSON.stringify(tabs.map((t) => t.trim())) === JSON.stringify(["Dashboard", "Templates", "Audience", "Campaigns", "Schedules", "Analytics", "Suppressions", "Logs", "Providers"]),
    tabs.join("|"),
  );
  await page.getByText("Nothing here is simulated").waitFor();
  await page.getByText("No provider is configured for this organization").waitFor();
  check("dashboard warns that no provider is configured (does not claim healthy)", true);
  check("dashboard shows real zero quota usage", (await text()).includes("0 / 1000"));
  await shot("A-dashboard-no-provider");

  await tab("Providers");
  await page.getByText("No providers configured for this organization").waitFor();
  check("providers tab: honest empty state", true);
  await shot("A-providers-empty");

  await tab("Templates");
  await page.getByText("No templates yet").waitFor();
  await page.getByRole("button", { name: "New template" }).click();
  await dialog().getByLabel("Name").fill("Welcome");
  await dialog().getByLabel("Subject").fill("Hello {{first_name}}");
  await dialog().getByLabel("Body").fill("<p>Hi {{first_name}} from {{company}}</p>");
  check("new-template dialog warns an email template has no unsubscribe placeholder", (await dialog().innerText()).includes("No {{unsubscribe_url}} yet"));
  await dialog().getByRole("button", { name: "Create template" }).click();
  await page.getByRole("cell", { name: "Welcome", exact: true }).waitFor();
  check("template created through the UI and listed", true);
  await shot("A-templates");

  // A campaign cannot use it: the wizard says why and refuses to continue.
  await tab("Campaigns");
  await page.getByText("No campaigns yet").waitFor();
  await page.getByRole("button", { name: "New campaign" }).click();
  const w0 = dialog();
  await w0.getByRole("combobox", { name: "Template" }).click();
  await page.getByRole("option", { name: "Welcome" }).click();
  await w0.getByText("Select all shown").waitFor();
  await w0.getByText("Select all shown").click();
  check("wizard flags a template without {{unsubscribe_url}}", (await w0.innerText()).includes("has no {{unsubscribe_url}} placeholder"));
  check("...and will not continue with it", await w0.getByRole("button", { name: /^Continue/ }).isDisabled());
  await shot("A-wizard-missing-unsubscribe");
  await w0.getByRole("button", { name: "Cancel" }).click();

  // Fix it through the Edit dialog (template editing).
  await tab("Templates");
  await page.getByRole("button", { name: "Edit Welcome" }).click();
  const ed = dialog();
  await ed.getByLabel("Body").fill('<p>Hi {{first_name}} from {{company}}</p><p><a href="{{unsubscribe_url}}">Unsubscribe</a></p>');
  check("edit dialog confirms the placeholder is present", (await ed.innerText()).includes("Contains the unsubscribe link placeholder"));
  await ed.getByRole("button", { name: "Save changes" }).click();
  await ed.waitFor({ state: "detached" });
  check("template edited through the UI", true);
  await shot("A-template-edited");

  await tab("Campaigns");
  await page.getByRole("button", { name: "New campaign" }).click();
  const wiz = dialog();
  await wiz.getByRole("combobox", { name: "Template" }).click();
  await page.getByRole("option", { name: "Welcome" }).click();
  await wiz.getByText("Select all shown").waitFor();
  const invalidBadges = await wiz.getByText("invalid", { exact: true }).count();
  check("wizard lists leads and flags the invalid address", invalidBadges === 1, `invalid badges=${invalidBadges}`);
  check("contact with no email is not offered for email", !(await wiz.innerText()).includes("Phone Only"));
  await wiz.getByText("Select all shown").click();
  const selectedText = await wiz.getByText(/\d+ selected/).innerText();
  check("select-all selects the 5 usable leads only", selectedText.trim() === "5 selected", selectedText);
  await shot("A-wizard-leads");
  await wiz.getByRole("button", { name: /Continue with 5 lead/ }).click();
  const createBtn = wiz.getByRole("button", { name: "Create draft campaign" });
  await wiz.getByLabel("Campaign name").fill("Autumn RFQ push");
  check("create is disabled until consent is attested", await createBtn.isDisabled());
  await wiz.getByRole("checkbox").click();
  check("create enabled after consent + name", await createBtn.isEnabled());
  await createBtn.click();
  await wiz.getByText("Campaign created").waitFor();
  check("audience summary shown (5 in campaign)", (await wiz.innerText()).includes("In campaign"));
  await shot("A-wizard-created");
  await wiz.getByRole("button", { name: "Open campaign" }).click();

  const det = dialog();
  await det.getByText("3. Send test").waitFor();
  check("new campaign is a draft", (await det.innerText()).includes("draft"));
  check("Schedule is disabled before any test", await det.getByRole("button", { name: /Schedule campaign|Reschedule/ }).isDisabled());
  check("Execute is disabled before any test", await det.getByRole("button", { name: "Execute campaign" }).isDisabled());
  check("the reason is stated on screen", (await det.innerText()).includes("Send a test message first"));
  await shot("A-detail-gated");

  await det.getByLabel("Test email address").fill("owner@example.com");
  await det.getByRole("button", { name: "Send test message" }).click();
  await det.getByText("Test message queued").waitFor();
  check("test send queued through the real API", true);
  check("still gated: a QUEUED test does not unlock anything", await det.getByRole("button", { name: "Execute campaign" }).isDisabled());
  console.log("tick:", await tick());
  await det.getByRole("button", { name: "Refresh" }).click();
  await det.getByText("PROVIDER_NOT_CONFIGURED").first().waitFor({ timeout: 8000 });
  check("with NO provider the test FAILS and the real error is shown", true);
  check("gate stays closed after the failed test", await det.getByRole("button", { name: "Execute campaign" }).isDisabled());
  check("reason names the failed test", /"failed"|failed/.test(await det.innerText()));
  await shot("A-detail-test-failed");
  await page.keyboard.press("Escape");

  await tab("Logs");
  await page.getByLabel("Include test sends").click();
  await page.getByRole("cell", { name: /owner@example.com/ }).first().waitFor();
  await page.getByRole("cell", { name: /owner@example.com/ }).first().click();
  await page.getByText("No provider was ever called for this message").waitFor();
  check("logs: failed test shown; attempts dialog says no provider was ever called", true);
  await shot("A-logs-attempts");
  await page.keyboard.press("Escape");

  await tab("Dashboard");
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByText(/dead-lettered|job\(s\) are waiting|No provider is configured/).first().waitFor();
  check("dashboard still warns (no provider)", (await text()).includes("No provider is configured"));
  await shot("A-dashboard-after");

  // ---------------------------------------------------------------- Scenario B: provider (TEST DOUBLE) works
  await get("/__provider?mode=ok");
  await page.reload();
  await tab("Providers");
  await page.getByText("Resend (TEST DOUBLE)").waitFor();
  const provText = await text();
  check("providers tab: credentials configured, but UNVERIFIED (no real send yet)", provText.includes("configured") && provText.includes("unverified"));
  await page.getByRole("button", { name: "Health check" }).click();
  await page.getByText(/healthy/i).first().waitFor();
  check("health check runs the adapter and records the result", true);
  await shot("B-providers");

  await tab("Campaigns");
  await page.getByRole("cell", { name: "Autumn RFQ push" }).click();
  const d2 = dialog();
  await d2.getByLabel("Test email address").fill("owner@example.com");
  await d2.getByRole("button", { name: "Send test message" }).click();
  await d2.getByText("Test message queued").waitFor();
  check("still gated until the worker has actually sent the test", await d2.getByRole("button", { name: "Execute campaign" }).isDisabled());
  console.log("tick:", await tick());
  await d2.getByRole("button", { name: "Refresh" }).click();
  await d2.getByText("Test to owner@example.com was sent").waitFor({ timeout: 8000 });
  check("after a real send through the worker path the test is VERIFIED", true);
  check("Execute is now enabled", await d2.getByRole("button", { name: "Execute campaign" }).isEnabled());
  check("Schedule needs a time first", await d2.getByRole("button", { name: /Schedule campaign|Reschedule/ }).isDisabled());
  await shot("B-detail-verified");

  const when = new Date(Date.now() + 3 * 3600_000);
  const p = (n) => String(n).padStart(2, "0");
  const local = `${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())}T${p(when.getHours())}:${p(when.getMinutes())}`;
  await d2.getByLabel(/Start at/).fill(local);
  await d2.getByRole("button", { name: "Schedule campaign" }).click();
  await d2.getByText("Campaign scheduled").waitFor();
  check("campaign scheduled for a future time", (await d2.innerText()).includes("scheduled"));
  await page.keyboard.press("Escape");
  await tab("Schedules");
  await page.getByRole("cell", { name: /Autumn RFQ push/ }).waitFor();
  check("schedules tab lists it with a queued run job, not overdue", (await text()).includes("queued") && !(await text()).includes("overdue"));
  check("worker evidence states a job has completed (the test send)", !(await text()).includes("no communication job has ever completed"));
  await shot("B-schedules");

  await page.getByRole("cell", { name: /Autumn RFQ push/ }).click();
  const d3 = dialog();
  await d3.getByRole("button", { name: "Execute campaign" }).click();
  await page.getByText("Send to real recipients?").waitFor();
  await shot("B-execute-confirm");
  await page.getByRole("button", { name: "Yes, send" }).click();
  await d3.getByText("Execution started").waitFor();
  console.log("tick 1:", await tick()); // expands the campaign
  console.log("tick 2:", await tick()); // sends the 5 messages
  await d3.getByRole("button", { name: "Refresh" }).click();
  await d3.getByText(/5 sent/).waitFor({ timeout: 8000 });
  const after = await d3.innerText();
  check("campaign executed: 5 sent, 0 failed, status completed", after.includes("5 sent") && after.includes("0 failed") && after.includes("completed"));
  await shot("B-campaign-completed");
  await page.keyboard.press("Escape");

  await tab("Logs");
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByRole("cell", { name: /asha@acme-buyers.example/ }).waitFor();
  const rows = await page.locator("tbody tr").count();
  check("logs show one row per campaign message (5) — tests hidden by default", rows === 5, `rows=${rows}`);
  await page.getByRole("cell", { name: /asha@acme-buyers.example/ }).click();
  await page.getByText("Delivery attempts").waitFor();
  check("attempt detail shows the provider call as sent", (await dialog().innerText()).includes("resend"));
  await shot("B-logs");
  await page.keyboard.press("Escape");

  await tab("Providers");
  await page.getByText(/verified ·/).waitFor();
  check("provider is now VERIFIED because a real send succeeded", true);
  await tab("Dashboard");
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByText("Messages, last 24 hours").waitFor();
  check("dashboard message counts reflect the 5 sent", (await text()).includes("5 message(s) created"));
  await shot("B-dashboard");

  // ---------------------------------------------------------------- Scenario D: audience, unsubscribe, suppressions, analytics
  const api = async (p) => (await fetch(BASE + p)).json();

  // D1 lists
  await tab("Audience");
  await page.getByText("No lists yet").waitFor();
  await page.getByRole("button", { name: "New list" }).click();
  await dialog().getByLabel("Name").fill("Steel and Chem");
  await dialog().getByRole("button", { name: "Create list" }).click();
  await page.getByRole("cell", { name: /Steel and Chem/ }).first().waitFor();
  await page.getByRole("button", { name: "Manage members of Steel and Chem" }).click();
  const md = dialog();
  await md.getByLabel("Search contacts to add").fill("steelworks");
  await md.getByText("Ravi Shah").first().waitFor();
  await md.getByRole("checkbox").first().click();
  await md.getByRole("button", { name: /Add 1 selected/ }).click();
  await md.getByText(/1 added/).waitFor();
  await md.getByLabel("Search contacts to add").fill("acme");
  await md.getByText("Asha Rao").first().waitFor();
  await md.getByRole("checkbox").first().click();
  await md.getByRole("button", { name: /Add 1 selected/ }).click();
  await md.getByRole("cell", { name: "Asha Rao", exact: true }).waitFor();
  check("list members added through the UI (Ravi + Asha)", (await md.getByRole("cell", { name: "Ravi Shah", exact: true }).count()) === 1);
  await shot("D-list-members");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Refresh" }).first().click();
  const listRow = page.getByRole("row", { name: /Steel and Chem/ });
  check("list shows 2 members", /\b2\b/.test(await listRow.innerText()));

  // D2 segment
  await page.getByRole("button", { name: "New segment" }).click();
  const sd = dialog();
  await sd.getByLabel("Name", { exact: true }).fill("Steel companies");
  check("segment cannot be saved without a condition", await sd.getByRole("button", { name: "Save segment" }).isDisabled());
  await sd.getByLabel("Company contains").fill("steel");
  await sd.getByRole("button", { name: "Preview matches" }).click();
  await sd.getByText(/match;/).waitFor();
  check("segment preview counts real matches (1: Steelworks)", /1\s*contact\(s\) with a usable email address match/.test(await sd.innerText()));
  await shot("D-segment-preview");
  await sd.getByRole("button", { name: "Save segment" }).click();
  await page.getByRole("cell", { name: /company contains "steel"/ }).waitFor();
  check("segment saved and described", true);

  // D3 unsubscribe through the REAL public link that was handed to the provider
  const suppBefore = (await api("/api/communications/suppressions")).total;
  const unsubUrl = await get("/__unsub-url?to=asha@acme-buyers.example");
  check("the provider was handed a signed unsubscribe link for a campaign email", /\/api\/communications\/unsubscribe\?t=/.test(unsubUrl), unsubUrl.slice(0, 60));
  const pub = await browser.newPage();
  await pub.goto(unsubUrl);
  await pub.getByRole("button", { name: "Unsubscribe" }).waitFor();
  check("opening the link only asks for confirmation (GET does not unsubscribe)", (await api("/api/communications/suppressions")).total === suppBefore);
  check("the page masks the address", (await pub.locator("body").innerText()).includes("a***@acme-buyers.example"));
  await pub.screenshot({ path: path.join(SHOTS, `${String(++step).padStart(2, "0")}-D-unsubscribe-confirm.png` ) });
  await pub.getByRole("button", { name: "Unsubscribe" }).click();
  await pub.getByText("You are unsubscribed").waitFor();
  check("confirming unsubscribes", (await api("/api/communications/suppressions")).total === suppBefore + 1);
  await pub.close();

  // D4 suppressions tab
  await page.reload();
  await tab("Suppressions");
  await page.getByRole("cell", { name: /asha@acme-buyers.example/ }).first().waitFor();
  const supRow = await page.getByRole("row", { name: /asha@acme-buyers.example/ }).innerText();
  check("suppressions tab lists the unsubscribe with its reason and source", supRow.includes("unsubscribed") && supRow.includes("unsubscribe_link"), supRow.replace(/\s+/g, " "));
  await page.getByRole("button", { name: "Add addresses" }).click();
  const ad = dialog();
  await ad.getByLabel("Addresses").fill("divya@textilehub.example\nnot-an-email");
  await ad.getByRole("button", { name: /Add 2 address/ }).click();
  await ad.getByText(/1 entry was not valid/).waitFor();
  check("invalid entries are reported and left in the box, valid ones are added", (await ad.getByLabel("Addresses").inputValue()).trim() === "not-an-email");
  await shot("D-suppress-add");
  await ad.getByRole("button", { name: "Close" }).first().click();
  await page.getByRole("cell", { name: /divya@textilehub.example/ }).first().waitFor();
  check("manual suppression listed", true);
  await shot("D-suppressions");

  // D5 campaign from the LIST: the unsubscribed member is left out and counted
  await tab("Campaigns");
  await page.getByRole("button", { name: "New campaign" }).click();
  const w2 = dialog();
  await w2.getByRole("combobox", { name: "Template" }).click();
  await page.getByRole("option", { name: "Welcome" }).click();
  await w2.getByRole("combobox", { name: "Audience source" }).click();
  await page.getByRole("option", { name: "A saved list" }).click();
  await w2.getByRole("combobox", { name: "List" }).click();
  await page.getByRole("option", { name: /Steel and Chem \(2\)/ }).click();
  await shot("D-wizard-list");
  await w2.getByRole("button", { name: "Continue" }).click();
  await w2.getByLabel("Campaign name").fill("List push");
  await w2.getByRole("checkbox").click();
  await w2.getByRole("button", { name: "Create draft campaign" }).click();
  await w2.getByText("Campaign created").waitFor();
  const created = (await api("/api/communications/campaigns")).campaigns.find((c) => c.name === "List push");
  check(
    "campaign from a list: 1 recipient, the unsubscribed one suppressed and counted",
    created && created.total_recipients === 1 && created.audience_summary.suppressed === 1 && created.audience.type === "list",
    JSON.stringify(created && created.audience_summary),
  );
  check("wizard summary shows the Suppressed count", (await w2.innerText()).includes("Suppressed"));
  await shot("D-wizard-list-created");
  await w2.getByRole("button", { name: "Open campaign" }).click();

  // D6 fail closed when unsubscribe is not configured on the server
  const d6 = dialog();
  await d6.getByText("3. Send test").waitFor();
  await get("/__unsub?mode=off");
  await d6.getByRole("button", { name: "Refresh" }).click();
  await d6.getByText(/no COMM_UNSUBSCRIBE_SECRET|has no COMM_UNSUBSCRIBE_SECRET/).first().waitFor({ timeout: 8000 });
  check("with unsubscribe unconfigured the UI says so and Execute stays disabled", await d6.getByRole("button", { name: "Execute campaign" }).isDisabled());
  await shot("D-unsubscribe-not-configured");
  await get("/__unsub?mode=on");
  await page.keyboard.press("Escape");

  // D7 template lock while an unfinished campaign uses it
  await tab("Templates");
  await page.getByRole("button", { name: "Edit Welcome" }).click();
  const ed2 = dialog();
  await ed2.getByLabel("Body").fill('<p>changed</p><a href="{{unsubscribe_url}}">u</a>');
  await ed2.getByRole("button", { name: "Save changes" }).click();
  await ed2.getByText(/unfinished campaign/).waitFor();
  check("template content is locked while a draft campaign uses it (server refusal shown)", true);
  await shot("D-template-locked");
  await ed2.getByLabel("Name").fill("Welcome v2");
  await ed2.getByLabel("Body").fill('<p>Hi {{first_name}} from {{company}}</p><p><a href="{{unsubscribe_url}}">Unsubscribe</a></p>');
  await ed2.getByRole("button", { name: "Save changes" }).click();
  await ed2.waitFor({ state: "detached" });
  check("renaming is still allowed while the template is in use", true);

  // D8 analytics
  await tab("Analytics");
  await page.getByText("Messages created").waitFor();
  const orgA = await api("/api/communications/analytics?days=30");
  const sum = orgA.daily.reduce((a, r) => a + r.total, 0);
  check("org analytics count only real non-test messages (5 from the campaign)", sum === 5, "sum=" + sum);
  check("analytics page states delivery is not tracked for email", (await text()).includes("not tracked"));
  await shot("D-analytics");
  await page.getByRole("cell", { name: /Autumn RFQ push/ }).click();
  const ca = dialog();
  await ca.getByText("Accepted by provider").waitFor();
  check("per-campaign analytics: 5 accepted (100%) of a completed campaign", (await ca.innerText()).includes("5 (100%)"));
  check("...and delivered/open/click rates are NOT invented", !/delivered %|open rate|click rate/i.test(await ca.innerText()));
  await shot("D-campaign-analytics");
  await page.keyboard.press("Escape");

  // ---------------------------------------------------------------- Scenario C: provider failing -> campaign ends failed (fail closed)
  check("no uncaught page errors", consoleErrors.filter((e) => e.startsWith("PAGEERROR")).length === 0, consoleErrors.slice(0, 3).join(" | "));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("E2E ERROR:", e.message.split("\n").slice(0, 6).join("\n"));
  process.exit(2);
});
