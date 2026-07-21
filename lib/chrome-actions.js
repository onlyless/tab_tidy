export async function activateBrowserTab(chromeApi, tab) {
  await chromeApi.tabs.update(tab.id, { active: true });
  await chromeApi.windows.update(tab.windowId, { focused: true });
}

export async function moveBrowserTab(chromeApi, tabId, windowId) {
  return chromeApi.tabs.move(tabId, { windowId, index: -1 });
}
