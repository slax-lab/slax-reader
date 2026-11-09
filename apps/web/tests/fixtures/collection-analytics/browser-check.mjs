// Local fixture verification only; no real Google credentials or production subscriptions.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const requireWeb = createRequire(import.meta.url);
const { chromium } = createRequire(requireWeb.resolve("@nuxt/test-utils"))(
  "playwright-core",
);
const origin = process.argv[2] || "http://localhost:3215";
const fixtureToken =
  Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url") +
  "." +
  Buffer.from(
    JSON.stringify({
      id: "7",
      email: "fixture@example.test",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url") +
  ".fixture";
const attribution = {
  collection_id: "Collection123",
  source_screen: "collection",
  presentation: "modal",
  trigger_element_id: "collection_subscribe_button",
};
async function until(fn) {
  const end = Date.now() + 15000;
  while (!fn()) {
    if (Date.now() > end)
      throw new Error("Timed out waiting for observed request");
    await new Promise((r) => setTimeout(r, 50));
  }
}
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    const events = [],
      logins = [],
      subscriptions = [],
      errors = [];
    let authenticated = false;
    page.on("pageerror", (e) => errors.push(e.message));
    await context.route("**/events", (r) => {
      if (r.request().method() === "POST")
        events.push(
          ...r
            .request()
            .postDataJSON()
            .events.map((e) => ({
              ...e,
              device: r.request().headers()["x-device-id"],
            })),
        );
      return r.fulfill({
        json: { received: 1, dropped: 0 },
        headers: { "access-control-allow-origin": "*" },
      });
    });
    await context.route("**/api/collection/track", (r) =>
      r.fulfill({ json: { ok: true } }),
    );
    await context.route("**/api/auth/session", (r) => {
      const request = r.request().postDataJSON();
      assert.equal(request.token, fixtureToken);
      return r.fulfill({
        status: 204,
        headers: { "set-cookie": `slax_test=${request.token}; Path=/` },
      });
    });
    await context.route(
      (url) => url.pathname === "/m",
      (r) => r.fulfill({ json: { code: 200, data: null, message: "fixture" } }),
    );
    await context.route("**/v1/**", async (r) => {
      const path = new URL(r.request().url()).pathname;
      const headers = { "access-control-allow-origin": "*" };
      let data = null;
      if (path === "/v1/user/login") {
        logins.push({
          body: r.request().postDataJSON(),
          device: r.request().headers()["x-device-id"],
        });
        authenticated = true;
        data = { token: fixtureToken };
      }
      if (path === "/v1/user/refresh") data = { token: fixtureToken };
      if (path === "/v1/sync/token") data = { token: "", endpoint: "" };
      if (path === "/v1/user/me" && authenticated)
        data = {
          userId: 7,
          uuid: "fixture-user",
          email: "fixture@example.test",
          lang: "en",
          name: "Fixture",
          picture: "",
          timezone: "UTC",
          subscription_type: 0,
          subscription_end_at: null,
        };
      if (path === "/v1/collection/subscribed")
        data = {
          subscribed: false,
          deleted: false,
          cancelled: false,
          end_time: "",
        };
      if (path === "/v1/collection/subscribe") {
        subscriptions.push(r.request().postDataJSON());
        data = { subscribe: true };
      }
      return r.fulfill({
        json: { code: 200, message: "fixture", data },
        headers,
      });
    });
    await context.route("https://accounts.google.com/**", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: "<h1>Local authorization fixture</h1>",
      }),
    );
    const opens = () =>
      events.filter((e) => e.event_name === "collection_opened");
    const clicks = (id) =>
      events.filter(
        (e) =>
          e.event_name === "element_clicked" && e.properties.element_id === id,
      );
    const views = () =>
      events.filter(
        (e) =>
          e.event_name === "screen_viewed" &&
          e.properties.source_screen === "collection",
      );
    const spa = (path) =>
      page.evaluate(
        (path) =>
          document
            .querySelector("#slax-reader-dweb")
            .__vue_app__.config.globalProperties.$router.push(path),
        path,
      );
    await page.goto(origin + "/c/Collection123", { waitUntil: "networkidle" });
    await page.locator(".collection-action-btn.is-visitor").waitFor();
    await until(() => opens().length === 1);
    assert.equal(opens()[0].properties.surface, "public_page");
    assert(opens()[0].device);
    await spa("/c/Collection123?page=2");
    await page.locator(".cp-empty-view").waitFor();
    await spa("/c/Collection123");
    await page.locator(".collection-action-btn.is-visitor").waitFor();
    assert.equal(opens().length, 1);
    await spa("/c/Other456");
    await until(() => opens().length === 2);
    assert.equal(opens()[1].properties.collection_id, "Other456");
    await spa("/c/Collection123");
    await until(() => opens().length === 3);
    await page.reload({ waitUntil: "networkidle" });
    await until(() => opens().length === 4);
    for (const code of ["Missing123", "Closed123"]) {
      const before = opens().length;
      await page.goto(origin + "/c/" + code, { waitUntil: "networkidle" });
      await page.locator(".cp-empty-view").waitFor();
      assert.equal(opens().length, before);
    }
    await page.goto(origin + "/c/Collection123", { waitUntil: "networkidle" });
    await page.locator(".collection-action-btn.is-visitor").waitFor();
    await page.locator(".collection-action-btn.is-visitor").click();
    await page.locator(".login-modal.appear").waitFor();
    await until(() => views().length === 1);
    await page.locator(".login-modal .modal-close").click();
    await page.locator(".login-modal").waitFor({ state: "detached" });
    assert.equal(clicks("login_google_button").length, 0);
    await page.locator(".collection-action-btn.is-visitor").click();
    await page.locator(".login-modal.appear").waitFor();
    await until(() => views().length === 2);
    assert.equal(
      await page.locator(".login-modal .apple-login-button").count(),
      1,
    );
    await page.locator(".login-modal .google-login-button").click();
    await page.waitForURL("https://accounts.google.com/**");
    await until(() => clicks("login_google_button").length === 1);
    const rawState = new URL(page.url()).searchParams.get("state");
    const state = JSON.parse(rawState);
    assert.deepEqual(state.auth_attribution, attribution);
    assert(state.target.includes("subscribe_after_login=1"));
    await page.goto(
      origin +
        "/auth?" +
        new URLSearchParams({
          code: "local-fixture-code",
          state: rawState,
        }),
      { waitUntil: "domcontentloaded" },
    );
    await until(() => subscriptions.length === 1);
    assert.equal(logins.length, 1);
    assert.deepEqual(logins[0].body.auth_attribution, attribution);
    assert.equal(logins[0].device, opens()[0].device);
    assert.equal(clicks("collection_subscribe_button").length, 2);
    assert.equal(clicks("login_google_button").length, 1);
    assert(
      !events.some((e) =>
        ["user_created", "user_logged_in", "collection_subscribed"].includes(
          e.event_name,
        ),
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        result: "PASS",
        checks: [
          "SSR/hydration one open",
          "pagination no extra open",
          "different collection and re-entry",
          "reload new open",
          "missing/closed excluded",
          "dismiss and reopen modal",
          "one contextual Google click",
          "Apple preserved",
          "OAuth callback provenance",
          "same-origin device continuity",
          "automatic subscription no extra click",
          "no client success duplicate",
        ],
        openCount: opens().length,
        subscribeClicks: 2,
        modalViews: 2,
        googleClicks: 1,
        loginRequests: 1,
        subscriptionRequests: 1,
      }),
    );
    await context.close();
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
