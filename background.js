import { getPreviousActiveTabId } from "./lib/tab-utils.js";

const HISTORY_KEY = "activationHistory";
let historyQueue = Promise.resolve();

chrome.tabs.onActivated.addListener((activeInfo) => {
  enqueueHistoryTask(() => recordActivation(activeInfo.windowId, activeInfo.tabId));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueueHistoryTask(() => removeFromHistory(tabId));
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "activate-previous-tab") return;
  enqueueHistoryTask(activatePreviousTab);
});

async function activatePreviousTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab?.id == null || activeTab.windowId == null) return;

  const tabs = await chrome.tabs.query({ windowId: activeTab.windowId });
  const histories = await getHistories();
  const windowHistory = histories[String(activeTab.windowId)] ?? [];
  const previousTabId = getPreviousActiveTabId(windowHistory, activeTab.id, tabs);
  if (previousTabId != null) {
    await chrome.tabs.update(previousTabId, { active: true });
  }
}

async function recordActivation(windowId, tabId) {
  const histories = await getHistories();
  const key = String(windowId);
  const history = histories[key] ?? [];
  histories[key] = [tabId, ...history.filter((id) => id !== tabId)].slice(0, 50);
  await chrome.storage.session.set({ [HISTORY_KEY]: histories });
}

async function removeFromHistory(tabId) {
  const histories = await getHistories();
  let changed = false;
  for (const [windowId, history] of Object.entries(histories)) {
    const filtered = history.filter((id) => id !== tabId);
    if (filtered.length !== history.length) {
      histories[windowId] = filtered;
      changed = true;
    }
  }
  if (changed) await chrome.storage.session.set({ [HISTORY_KEY]: histories });
}

async function getHistories() {
  const stored = await chrome.storage.session.get(HISTORY_KEY);
  return stored[HISTORY_KEY] ?? {};
}

function enqueueHistoryTask(task) {
  historyQueue = historyQueue
    .then(task)
    .catch((error) => console.error("标签历史记录操作失败", error));
}
