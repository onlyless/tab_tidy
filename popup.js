import { getCurrentTabId, getDuplicatePlan, getTabLabel, getTitlePreview, getWindowGroups, matchesSearch } from "./lib/tab-utils.js";
import { activateBrowserTab, moveBrowserTab } from "./lib/chrome-actions.js";
import { getMessage, localizeDocument } from "./lib/i18n.js";

const t = (key, substitutions) => getMessage(chrome.i18n, key, substitutions);
localizeDocument(document, chrome.i18n);
document.title = t("extensionName");

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
  tabGroups: [],
  selected: new Set(),
  query: "",
  view: "compact",
  collapsedWindows: new Set(),
  collapsedTabGroups: new Set(),
  manuallyToggledTabGroups: new Set(),
  searchCollapsedTabGroups: new Set(),
  currentWindowId: null,
  shouldAutoLocate: true,
  toastTimer: null,
  draggedTabId: null,
  suppressTabClick: false
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
  elements.searchInput.focus({ preventScroll: true });
}

function bindEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    const hadQuery = Boolean(state.query.trim());
    state.query = event.target.value;
    if (!hadQuery || !state.query.trim()) state.searchCollapsedTabGroups.clear();
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

  if (chrome.tabGroups) {
    chrome.tabGroups.onCreated?.addListener(refreshTabs);
    chrome.tabGroups.onUpdated?.addListener(refreshTabs);
    chrome.tabGroups.onMoved?.addListener(refreshTabs);
    chrome.tabGroups.onRemoved?.addListener(refreshTabs);
  }
}

async function refreshTabs() {
  const [tabs, tabGroups] = await Promise.all([
    chrome.tabs.query({}),
    queryTabGroups()
  ]);
  state.tabs = tabs;
  state.tabGroups = tabGroups;
  syncTabGroupCollapseState(tabGroups);
  if (state.shouldAutoLocate) {
    const currentTab = state.tabs.find((tab) => tab.windowId === state.currentWindowId && tab.active);
    if ((currentTab?.groupId ?? -1) >= 0) {
      state.collapsedTabGroups.delete(currentTab.groupId);
      state.manuallyToggledTabGroups.add(currentTab.groupId);
    }
  }
  const liveIds = new Set(state.tabs.map((tab) => tab.id));
  state.selected = new Set([...state.selected].filter((id) => liveIds.has(id)));
  render();
}

async function queryTabGroups() {
  if (!chrome.tabGroups?.query) return [];
  try {
    return await chrome.tabGroups.query({});
  } catch (error) {
    console.warn("Could not read tab groups", error);
    return [];
  }
}

function syncTabGroupCollapseState(tabGroups) {
  const liveGroupIds = new Set(tabGroups.map((group) => group.id));
  for (const group of tabGroups) {
    if (state.manuallyToggledTabGroups.has(group.id)) continue;
    group.collapsed
      ? state.collapsedTabGroups.add(group.id)
      : state.collapsedTabGroups.delete(group.id);
  }
  for (const groupId of state.manuallyToggledTabGroups) {
    if (!liveGroupIds.has(groupId)) state.manuallyToggledTabGroups.delete(groupId);
  }
  for (const groupId of state.collapsedTabGroups) {
    if (!liveGroupIds.has(groupId)) state.collapsedTabGroups.delete(groupId);
  }
  for (const groupId of state.searchCollapsedTabGroups) {
    if (!liveGroupIds.has(groupId)) state.searchCollapsedTabGroups.delete(groupId);
  }
}

function getVisibleTabs() {
  return state.tabs.filter((tab) => matchesSearch(tab, state.query));
}

function render() {
  const visibleTabs = getVisibleTabs();
  const duplicatePlan = getDuplicatePlan(state.tabs);

  elements.tabSummary.textContent = t("tabSummary", [String(state.tabs.length), String(getWindowGroups(state.tabs).length)]);
  elements.resultCount.textContent = t("resultCount", String(visibleTabs.length));
  elements.selectedCount.textContent = state.selected.size;
  elements.closeSelectedButton.disabled = state.selected.size === 0;

  elements.dedupeButton.disabled = duplicatePlan.removeIds.length === 0;
  elements.dedupeLabel.textContent = duplicatePlan.removeIds.length
    ? t("cleanDuplicateCount", String(duplicatePlan.removeIds.length))
    : t("noDuplicates");

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
    section.dataset.windowId = String(group.windowId);
    section.addEventListener("dragover", (event) => handleWindowDragOver(event, section, group.windowId));
    section.addEventListener("dragleave", (event) => {
      if (!section.contains(event.relatedTarget)) section.classList.remove("is-drop-target");
    });
    section.addEventListener("drop", (event) => moveDraggedTab(event, section, group.windowId, groupIndex));

    const heading = document.createElement("button");
    heading.className = "window-heading";
    heading.type = "button";
    const isCollapsed = state.collapsedWindows.has(group.windowId);
    heading.setAttribute("aria-expanded", String(!isCollapsed));
    heading.setAttribute("aria-label", t(isCollapsed ? "expandWindow" : "collapseWindow", String(groupIndex + 1)));
    const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chevron.setAttribute("viewBox", "0 0 24 24");
    chevron.setAttribute("aria-hidden", "true");
    const chevronPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    chevronPath.setAttribute("d", "m8 10 4 4 4-4");
    chevron.append(chevronPath);
    const title = document.createElement("h2");
    title.textContent = groups.length === 1
      ? t("currentTabs")
      : group.windowId === state.currentWindowId ? t("currentWindow") : t("windowIndex", String(groupIndex + 1));
    const count = document.createElement("span");
    count.textContent = group.tabs.length;
    heading.append(chevron, title, count);
    heading.addEventListener("click", () => {
      state.collapsedWindows.has(group.windowId)
        ? state.collapsedWindows.delete(group.windowId)
        : state.collapsedWindows.add(group.windowId);
      render();
    });

    const content = document.createElement("div");
    content.className = "window-content";
    content.hidden = isCollapsed;
    if (!isCollapsed) {
      appendWindowTabSections(content, group.tabs);
    }
    section.classList.toggle("is-collapsed", isCollapsed);
    section.append(heading, content);
    elements.tabList.append(section);
  });

  if (state.shouldAutoLocate) {
    state.shouldAutoLocate = false;
    requestAnimationFrame(locateCurrentTab);
  }
}

function appendWindowTabSections(container, tabs) {
  const groupsById = new Map(state.tabGroups.map((group) => [group.id, group]));
  const sections = [];
  const groupSections = new Map();
  const orderedTabs = [...tabs].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  for (const tab of orderedTabs) {
    if ((tab.groupId ?? -1) >= 0) {
      let section = groupSections.get(tab.groupId);
      if (!section) {
        section = { type: "group", groupId: tab.groupId, tabs: [] };
        groupSections.set(tab.groupId, section);
        sections.push(section);
      }
      section.tabs.push(tab);
      continue;
    }

    let section = sections.at(-1);
    if (!section || section.type !== "tabs") {
      section = { type: "tabs", tabs: [] };
      sections.push(section);
    }
    section.tabs.push(tab);
  }

  for (const section of sections) {
    if (section.type === "tabs") {
      const grid = document.createElement("div");
      grid.className = "tab-grid";
      section.tabs.forEach((tab) => grid.append(createTabItem(tab)));
      container.append(grid);
      continue;
    }
    container.append(createTabGroupSection(section, groupsById.get(section.groupId)));
  }
}

function createTabGroupSection(sectionData, tabGroup) {
  const { groupId, tabs } = sectionData;
  const title = tabGroup?.title?.trim() || t("unnamedTabGroup");
  const isSearching = Boolean(state.query.trim());
  const collapsed = isSearching
    ? state.searchCollapsedTabGroups.has(groupId)
    : state.collapsedTabGroups.has(groupId);
  const section = document.createElement("section");
  section.className = "tab-group";
  section.dataset.groupId = String(groupId);
  if (tabGroup?.color) section.style.setProperty("--tab-group-color", getTabGroupColor(tabGroup.color));

  const heading = document.createElement("button");
  heading.className = "tab-group-heading";
  heading.type = "button";
  heading.setAttribute("aria-expanded", String(!collapsed));
  heading.setAttribute("aria-controls", `tab-group-content-${groupId}`);
  heading.setAttribute("aria-label", t(collapsed ? "expandTabGroup" : "collapseTabGroup", title));

  const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  chevron.classList.add("group-chevron");
  chevron.setAttribute("viewBox", "0 0 24 24");
  chevron.setAttribute("aria-hidden", "true");
  const chevronPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  chevronPath.setAttribute("d", "m8 10 4 4 4-4");
  chevron.append(chevronPath);

  const colorDot = document.createElement("span");
  colorDot.className = "tab-group-color";
  colorDot.setAttribute("aria-hidden", "true");
  const name = document.createElement("span");
  name.className = "tab-group-name";
  name.textContent = title;
  name.title = title;
  const count = document.createElement("span");
  count.className = "tab-group-count";
  count.textContent = String(tabs.length);
  heading.append(chevron, colorDot, name, count);

  heading.addEventListener("click", () => {
    const collapsedGroups = state.query.trim()
      ? state.searchCollapsedTabGroups
      : state.collapsedTabGroups;
    if (!state.query.trim()) state.manuallyToggledTabGroups.add(groupId);
    collapsedGroups.has(groupId)
      ? collapsedGroups.delete(groupId)
      : collapsedGroups.add(groupId);
    render();
  });

  const content = document.createElement("div");
  content.className = "tab-group-content tab-grid";
  content.id = `tab-group-content-${groupId}`;
  content.hidden = collapsed;
  if (!collapsed) tabs.forEach((tab) => content.append(createTabItem(tab)));
  section.classList.toggle("is-collapsed", collapsed);
  section.append(heading, content);
  return section;
}

function getTabGroupColor(color) {
  const colors = {
    grey: "#87918c",
    blue: "#4f7fe8",
    red: "#dc5d57",
    yellow: "#d6a125",
    green: "#479363",
    pink: "#d55491",
    purple: "#9264c7",
    cyan: "#35a6b0",
    orange: "#d47a2e"
  };
  return colors[color] ?? colors.grey;
}

function createTabItem(tab) {
  const tabTitle = tab.title || t("untitled");
  const tabLabel = getTabLabel(tab, t("newTab"));
  const item = document.createElement("article");
  item.className = "tab-item";
  item.classList.toggle("is-selected", state.selected.has(tab.id));
  item.classList.toggle("is-active-tab", Boolean(tab.active));
  item.dataset.tabId = String(tab.id);
  item.dataset.tooltip = tabTitle;
  item.draggable = true;
  item.setAttribute("aria-label", t("dragNamedTab", tabTitle));
  item.addEventListener("dragstart", (event) => startTabDrag(event, item, tab));
  item.addEventListener("dragend", () => endTabDrag(item));
  item.addEventListener("click", (event) => {
    if (state.suppressTabClick) return;
    if (event.target.closest(".tab-check, .single-close")) return;
    activateTab(tab);
  });

  const checkboxLabel = document.createElement("label");
  checkboxLabel.className = "tab-check";
  checkboxLabel.title = t("selectTab");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.selected.has(tab.id);
  checkbox.setAttribute("aria-label", t("selectNamedTab", tabTitle));
  checkbox.addEventListener("change", () => {
    checkbox.checked ? state.selected.add(tab.id) : state.selected.delete(tab.id);
    render();
  });
  checkboxLabel.append(checkbox);

  const openButton = document.createElement("button");
  openButton.className = "tab-open";
  openButton.type = "button";
  openButton.setAttribute("aria-label", t("openNamedTab", tabTitle));

  const favicon = createFavicon(tab);
  const text = document.createElement("span");
  text.className = "tab-text";
  const label = document.createElement("span");
  label.className = "tab-label";
  label.textContent = tabLabel;
  const title = document.createElement("span");
  title.className = "tab-title";
  title.textContent = tabTitle;
  const compactTitle = document.createElement("span");
  compactTitle.className = "tab-compact-title";
  compactTitle.textContent = getTitlePreview(tab.title, Infinity, t("untitled"));
  text.append(label, title, compactTitle);
  openButton.append(favicon, text);

  const closeButton = document.createElement("button");
  closeButton.className = "single-close";
  closeButton.type = "button";
  closeButton.title = t("closeTab");
  closeButton.setAttribute("aria-label", t("closeNamedTab", tabTitle));
  closeButton.textContent = "×";
  closeButton.addEventListener("click", () => chrome.tabs.remove(tab.id));

  item.append(checkboxLabel, openButton, closeButton);
  return item;
}

function startTabDrag(event, item, tab) {
  state.draggedTabId = tab.id;
  state.suppressTabClick = true;
  item.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(tab.id));
}

function endTabDrag(item) {
  item.classList.remove("is-dragging");
  clearDropTargets();
  state.draggedTabId = null;
  setTimeout(() => { state.suppressTabClick = false; }, 0);
}

function handleWindowDragOver(event, section, targetWindowId) {
  const draggedTab = state.tabs.find((tab) => tab.id === state.draggedTabId);
  if (!draggedTab || draggedTab.windowId === targetWindowId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  section.classList.add("is-drop-target");
}

async function moveDraggedTab(event, section, targetWindowId, groupIndex) {
  event.preventDefault();
  section.classList.remove("is-drop-target");
  const draggedTab = state.tabs.find((tab) => tab.id === state.draggedTabId);
  if (!draggedTab || draggedTab.windowId === targetWindowId) return;

  try {
    await moveBrowserTab(chrome, draggedTab.id, targetWindowId);
    showToast(t("movedTabToWindow", String(groupIndex + 1)));
    await refreshTabs();
  } catch (error) {
    showToast(t("moveTabFailed"));
    console.error(error);
  }
}

function clearDropTargets() {
  elements.tabList.querySelectorAll(".is-drop-target").forEach((element) => {
    element.classList.remove("is-drop-target");
  });
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
    showToast(t("cannotSwitchTab"));
    console.error(error);
  }
}

async function openShortcutSettings() {
  try {
    await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  } catch (error) {
    showToast(t("shortcutPageHint"));
    console.error(error);
  }
}

function createFavicon(tab) {
  const wrapper = document.createElement("span");
  wrapper.className = "favicon-wrap";
  const fallback = document.createElement("span");
  fallback.className = "favicon-fallback";
  fallback.textContent = getTabLabel(tab, t("newTab")).slice(0, 1).toLocaleUpperCase();
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
    showToast(t("closedTabCount", String(ids.length)));
    await refreshTabs();
  } catch (error) {
    showToast(t("partialCloseFailure"));
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
    showToast(t("cleanedDuplicateCount", String(plan.removeIds.length)));
    await refreshTabs();
  } catch (error) {
    showToast(t("partialDedupeFailure"));
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
  elements.tabSummary.textContent = t("cannotReadTabs");
  showToast(t("initializationFailed"));
  console.error(error);
});
