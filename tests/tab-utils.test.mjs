import assert from "node:assert/strict";
import test from "node:test";
import { activateBrowserTab, moveBrowserTab } from "../lib/chrome-actions.js";
import { getCurrentTabId, getDuplicatePlan, getPreviousActiveTabId, getTabLabel, getTitlePreview, matchesSearch, normalizeTitle } from "../lib/tab-utils.js";

test("normalizeTitle handles whitespace, width, and case", () => {
  assert.equal(normalizeTitle("  Ｔｅｓｔ   Page  "), "test page");
});

test("duplicate plan keeps the most recently accessed tab", () => {
  const plan = getDuplicatePlan([
    { id: 1, title: "Docs", active: false, pinned: true, lastAccessed: 100 },
    { id: 2, title: " docs ", active: true, pinned: false, lastAccessed: 90 },
    { id: 3, title: "Other", active: false }
  ]);
  assert.deepEqual(plan.keepIds, [1]);
  assert.deepEqual(plan.removeIds, [2]);
});

test("duplicate plan closes older inactive tabs before the newest tab", () => {
  const plan = getDuplicatePlan([
    { id: 4, title: "Inbox", pinned: false, lastAccessed: 300 },
    { id: 5, title: "Inbox", pinned: true, lastAccessed: 100 },
    { id: 6, title: "Inbox", pinned: false, lastAccessed: 400 }
  ]);
  assert.deepEqual(plan.keepIds, [6]);
  assert.deepEqual(plan.removeIds, [4, 5]);
});

test("duplicate plan uses active and pinned states only to break access-time ties", () => {
  const plan = getDuplicatePlan([
    { id: 7, title: "Tasks", active: false, pinned: true, lastAccessed: 500 },
    { id: 8, title: "Tasks", active: true, pinned: false, lastAccessed: 500 }
  ]);
  assert.deepEqual(plan.keepIds, [8]);
  assert.deepEqual(plan.removeIds, [7]);
});

test("blank titles do not count as duplicates", () => {
  assert.equal(getDuplicatePlan([{ id: 1, title: "" }, { id: 2 }]).removeIds.length, 0);
});

test("search matches both title and URL without case sensitivity", () => {
  const tab = { title: "Project Dashboard", url: "https://example.com/alpha" };
  assert.equal(matchesSearch(tab, "DASH"), true);
  assert.equal(matchesSearch(tab, "alpha"), true);
  assert.equal(matchesSearch(tab, "beta"), false);
});

test("tab labels use hostname and handle internal pages", () => {
  assert.equal(getTabLabel({ url: "https://www.example.com/path" }), "example.com");
  assert.equal(getTabLabel({ url: "chrome://settings/" }), "chrome");
  assert.equal(getTabLabel({ url: "not-a-url" }), "New tab");
  assert.equal(getTabLabel({ url: "not-a-url" }, "新标签页"), "新标签页");
});

test("title preview keeps the first characters without splitting emoji", () => {
  assert.equal(getTitlePreview("产品路线图 · Notion"), "产品路线图 · No…");
  assert.equal(getTitlePreview("😀标签页", 2), "😀标…");
  assert.equal(getTitlePreview("短标题"), "短标题");
});

test("previous active tab follows usage history rather than visual order", () => {
  const tabs = [
    { id: 1, index: 0, lastAccessed: 100 },
    { id: 2, index: 1, lastAccessed: 300 },
    { id: 3, index: 2, lastAccessed: 200 }
  ];
  assert.equal(getPreviousActiveTabId([1, 3, 2], 1, tabs), 3);
  assert.equal(getPreviousActiveTabId([1, 99, 2], 1, tabs), 2);
});

test("previous active tab falls back to lastAccessed when history is empty", () => {
  assert.equal(getPreviousActiveTabId([], 1, [
    { id: 1, lastAccessed: 500 },
    { id: 2, lastAccessed: 200 },
    { id: 3, lastAccessed: 400 }
  ]), 3);
  assert.equal(getPreviousActiveTabId([], 1, [{ id: 1, lastAccessed: 500 }]), null);
});

test("tab activation completes before focusing another window", async () => {
  const calls = [];
  const chromeApi = {
    tabs: { async update(id, options) { calls.push(["tab", id, options]); } },
    windows: { async update(id, options) { calls.push(["window", id, options]); } }
  };
  await activateBrowserTab(chromeApi, { id: 8, windowId: 12 });
  assert.deepEqual(calls, [
    ["tab", 8, { active: true }],
    ["window", 12, { focused: true }]
  ]);
});

test("tab movement appends a tab to the selected window", async () => {
  const calls = [];
  const chromeApi = {
    tabs: { async move(id, options) { calls.push([id, options]); return { id, ...options }; } }
  };
  const moved = await moveBrowserTab(chromeApi, 8, 12);
  assert.deepEqual(calls, [[8, { windowId: 12, index: -1 }]]);
  assert.deepEqual(moved, { id: 8, windowId: 12, index: -1 });
});

test("current tab is resolved from the window that opened the popup", () => {
  const tabs = [
    { id: 1, windowId: 10, active: true },
    { id: 2, windowId: 20, active: true },
    { id: 3, windowId: 20, active: false }
  ];
  assert.equal(getCurrentTabId(tabs, 20), 2);
  assert.equal(getCurrentTabId(tabs, 30), null);
});
