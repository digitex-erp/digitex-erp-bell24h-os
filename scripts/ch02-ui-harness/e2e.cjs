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
  check("tabs are Dashboard, Templates, Campaigns, Schedules, Logs, Providers (in that order)", JSON.stringify(tabs.map((t) => t.trim())) === JSON.stringify(["Dashboard", "Templates", "Campaigns", "Schedules", "Logs", "Providers"]), tabs.join("|"));
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
  await dialog().getByRole("button", { name: "Create template" }).click();
  await page.getByRole("cell", { name: "Welcome" }).waitFor();
  check("template created through the UI and listed", true);
  await shot("A-templates");

  await tab("Campaigns");
  await page.getByText("No campaigns yet").waitFor();
  await page.getByRole("button", { name: "New campaign" }).click();
  const wiz = dialog();
  await wiz.getByRole("combobox").nth(1).click();
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
