import { getCurrentTabId, getDuplicatePlan, getTabLabel, getTitlePreview, getWindowGroups, matchesSearch } from "./lib/tab-utils.js";
import { activateBrowserTab } from "./lib/chrome-actions.js";

const elements = {
  tabSummary: document.querySelector("#tabSummary"),
  shortcutButton: document.querySelector("#shortcutButton"),
  dedupeButton: document.querySelector("#dedupeButton"),
  dedupeLabel: document.querySelector("#dedupeLabel"),
  searchInput: document.querySelector("#searchInput"),
  viewButtons: [...document.querySelectorAll(".view-button")],
  selectAllCheckbox: document.querySelector("#selectAllCheckbox"),
  resultCount: document.querySelector("#resultCount"),
  closeSelectedButton: document.querySelector("#closeSelectedButton"),
  selectedCount: document.querySelector("#selectedCount"),
  tabList: document.querySelector("#tabList"),
  emptyState: document.querySelector("#emptyState"),
  toast: document.querySelector("#toast")
};

const state = {
  tabs: [],
  selected: new Set(),
  query: "",
  view: "compact",
  collapsedWindows: new Set(),
  currentWindowId: null,
  shouldAutoLocate: true,
  toastTimer: null
};

async function init() {
  bindEvents();
  const [saved, currentWindow] = await Promise.all([
    chrome.storage.local.get("viewMode"),
    chrome.windows.getCurrent()
  ]);
  state.view = ["compact", "icon", "detail"].includes(saved.viewMode) ? saved.viewMode : "compact";
  state.currentWindowId = currentWindow?.id ?? null;
  await refreshTabs();
}

function bindEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
      event.preventDefault();
      elements.searchInput.focus();
    }
    if (event.key === "Escape" && document.activeElement === elements.searchInput) {
      elements.searchInput.value = "";
      state.query = "";
      render();
    }
  });

  for (const button of elements.viewButtons) {
    button.addEventListener("click", async () => {
      state.view = button.dataset.view;
      await chrome.storage.local.set({ viewMode: state.view });
      render();
    });
  }

  elements.selectAllCheckbox.addEventListener("change", () => {
    const visibleIds = getVisibleTabs().map((tab) => tab.id);
    if (elements.selectAllCheckbox.checked) {
      visibleIds.forEach((id) => state.selected.add(id));
    } else {
      visibleIds.forEach((id) => state.selected.delete(id));
    }
    render();
  });

  elements.closeSelectedButton.addEventListener("click", closeSelectedTabs);
  elements.dedupeButton.addEventListener("click", removeDuplicates);
  elements.shortcutButton.addEventListener("click", openShortcutSettings);

  chrome.tabs.onCreated.addListener(refreshTabs);
  chrome.tabs.onRemoved.addListener((_tabId, removeInfo) => {
    if (!removeInfo.isWindowClosing) refreshTabs();
  });
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.title || changeInfo.url || changeInfo.status === "complete") refreshTabs();
  });
  chrome.tabs.onActivated.addListener(refreshTabs);
}

async function refreshTabs() {
  state.tabs = await chrome.tabs.query({});
  const liveIds = new Set(state.tabs.map((tab) => tab.id));
  state.selected = new Set([...state.selected].filter((id) => liveIds.has(id)));
  render();
}

function getVisibleTabs() {
  return state.tabs.filter((tab) => matchesSearch(tab, state.query));
}

function render() {
  const visibleTabs = getVisibleTabs();
  const duplicatePlan = getDuplicatePlan(state.tabs);

  elements.tabSummary.textContent = `${state.tabs.length} 个标签页 · ${getWindowGroups(state.tabs).length} 个窗口`;
  elements.resultCount.textContent = `${visibleTabs.length} 个结果`;
  elements.selectedCount.textContent = state.selected.size;
  elements.closeSelectedButton.disabled = state.selected.size === 0;

  elements.dedupeButton.disabled = duplicatePlan.removeIds.length === 0;
  elements.dedupeLabel.textContent = duplicatePlan.removeIds.length
    ? `清理 ${duplicatePlan.removeIds.length} 个重复页`
    : "没有重复页";

  const visibleSelected = visibleTabs.filter((tab) => state.selected.has(tab.id)).length;
  elements.selectAllCheckbox.checked = visibleTabs.length > 0 && visibleSelected === visibleTabs.length;
  elements.selectAllCheckbox.indeterminate = visibleSelected > 0 && visibleSelected < visibleTabs.length;
  elements.selectAllCheckbox.disabled = visibleTabs.length === 0;

  for (const button of elements.viewButtons) {
    const isActive = button.dataset.view === state.view;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
  elements.tabList.className = `tab-list ${state.view}-view`;

  elements.tabList.replaceChildren();
  elements.emptyState.hidden = visibleTabs.length > 0;
  if (!visibleTabs.length) return;

  const groups = getWindowGroups(visibleTabs);
  groups.forEach((group, groupIndex) => {
    const section = document.createElement("section");
    section.className = "window-group";

    const heading = document.createElement("button");
    heading.className = "window-heading";
    heading.type = "button";
    const isCollapsed = state.collapsedWindows.has(group.windowId);
    heading.setAttribute("aria-expanded", String(!isCollapsed));
    heading.setAttribute("aria-label", `${isCollapsed ? "展开" : "收起"}窗口 ${groupIndex + 1}`);
    const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chevron.setAttribute("viewBox", "0 0 24 24");
    chevron.setAttribute("aria-hidden", "true");
    const chevronPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    chevronPath.setAttribute("d", "m8 10 4 4 4-4");
    chevron.append(chevronPath);
    const title = document.createElement("h2");
    title.textContent = groups.length === 1
      ? "当前标签页"
      : group.windowId === state.currentWindowId ? "当前窗口" : `窗口 ${groupIndex + 1}`;
    const count = document.createElement("span");
    count.textContent = group.tabs.length;
    heading.append(chevron, title, count);
    heading.addEventListener("click", () => {
      state.collapsedWindows.has(group.windowId)
        ? state.collapsedWindows.delete(group.windowId)
        : state.collapsedWindows.add(group.windowId);
      render();
    });

    const grid = document.createElement("div");
    grid.className = "tab-grid";
    grid.hidden = isCollapsed;
    if (!isCollapsed) {
      group.tabs.forEach((tab) => grid.append(createTabItem(tab)));
    }
    section.classList.toggle("is-collapsed", isCollapsed);
    section.append(heading, grid);
    elements.tabList.append(section);
  });

  if (state.shouldAutoLocate) {
    state.shouldAutoLocate = false;
    requestAnimationFrame(locateCurrentTab);
  }
}

function createTabItem(tab) {
  const item = document.createElement("article");
  item.className = "tab-item";
  item.classList.toggle("is-selected", state.selected.has(tab.id));
  item.classList.toggle("is-active-tab", Boolean(tab.active));
  item.dataset.tabId = String(tab.id);
  item.dataset.tooltip = tab.title || "无标题";
  item.addEventListener("click", (event) => {
    if (event.target.closest(".tab-check, .single-close")) return;
    activateTab(tab);
  });

  const checkboxLabel = document.createElement("label");
  checkboxLabel.className = "tab-check";
  checkboxLabel.title = "选择标签页";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.selected.has(tab.id);
  checkbox.setAttribute("aria-label", `选择 ${tab.title || "无标题标签页"}`);
  checkbox.addEventListener("change", () => {
    checkbox.checked ? state.selected.add(tab.id) : state.selected.delete(tab.id);
    render();
  });
  checkboxLabel.append(checkbox);

  const openButton = document.createElement("button");
  openButton.className = "tab-open";
  openButton.type = "button";
  openButton.setAttribute("aria-label", `打开 ${tab.title || "无标题标签页"}`);

  const favicon = createFavicon(tab);
  const text = document.createElement("span");
  text.className = "tab-text";
  const label = document.createElement("span");
  label.className = "tab-label";
  label.textContent = getTabLabel(tab);
  const title = document.createElement("span");
  title.className = "tab-title";
  title.textContent = tab.title || "无标题";
  const compactTitle = document.createElement("span");
  compactTitle.className = "tab-compact-title";
  compactTitle.textContent = getTitlePreview(tab.title);
  text.append(label, title, compactTitle);
  openButton.append(favicon, text);

  const closeButton = document.createElement("button");
  closeButton.className = "single-close";
  closeButton.type = "button";
  closeButton.title = "关闭标签页";
  closeButton.setAttribute("aria-label", `关闭 ${tab.title || "无标题标签页"}`);
  closeButton.textContent = "×";
  closeButton.addEventListener("click", () => chrome.tabs.remove(tab.id));

  item.append(checkboxLabel, openButton, closeButton);
  return item;
}

function locateCurrentTab() {
  const currentTabId = getCurrentTabId(state.tabs, state.currentWindowId);
  if (currentTabId == null) return;
  const item = elements.tabList.querySelector(`[data-tab-id="${currentTabId}"]`);
  if (!item) return;
  item.scrollIntoView({ block: "center", inline: "nearest" });
  item.classList.add("is-located");
  setTimeout(() => item.classList.remove("is-located"), 1200);
}

async function activateTab(tab) {
  try {
    await activateBrowserTab(chrome, tab);
  } catch (error) {
    showToast("无法切换到该标签页");
    console.error(error);
  }
}

async function openShortcutSettings() {
  try {
    await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  } catch (error) {
    showToast("请打开 chrome://extensions/shortcuts");
    console.error(error);
  }
}

function createFavicon(tab) {
  const wrapper = document.createElement("span");
  wrapper.className = "favicon-wrap";
  const fallback = document.createElement("span");
  fallback.className = "favicon-fallback";
  fallback.textContent = getTabLabel(tab).slice(0, 1).toLocaleUpperCase();
  wrapper.append(fallback);

  if (tab.favIconUrl) {
    const image = document.createElement("img");
    image.className = "favicon";
    image.alt = "";
    image.src = tab.favIconUrl;
    image.addEventListener("load", () => fallback.remove());
    image.addEventListener("error", () => image.remove());
    wrapper.append(image);
  }
  return wrapper;
}

async function closeSelectedTabs() {
  const ids = [...state.selected];
  if (!ids.length) return;
  elements.closeSelectedButton.disabled = true;
  try {
    await chrome.tabs.remove(ids);
    state.selected.clear();
    showToast(`已关闭 ${ids.length} 个标签页`);
    await refreshTabs();
  } catch (error) {
    showToast("部分标签页未能关闭");
    console.error(error);
    await refreshTabs();
  }
}

async function removeDuplicates() {
  const plan = getDuplicatePlan(state.tabs);
  if (!plan.removeIds.length) return;
  elements.dedupeButton.disabled = true;
  try {
    await chrome.tabs.remove(plan.removeIds);
    showToast(`已清理 ${plan.removeIds.length} 个重复标签页`);
    await refreshTabs();
  } catch (error) {
    showToast("部分重复标签页未能清理");
    console.error(error);
    await refreshTabs();
  }
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  state.toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 2200);
}

init().catch((error) => {
  elements.tabSummary.textContent = "无法读取标签页";
  showToast("扩展初始化失败");
  console.error(error);
});
