export async function activateBrowserTab(chromeApi, tab) {
  await chromeApi.tabs.update(tab.id, { active: true });
  await chromeApi.windows.update(tab.windowId, { focused: true });
}
