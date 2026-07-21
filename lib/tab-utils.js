const INTERNAL_SCHEMES = new Set(["chrome:", "chrome-extension:", "edge:", "about:"]);

export function normalizeTitle(title) {
  return String(title ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

export function getDuplicatePlan(tabs) {
  const groups = new Map();

  for (const tab of tabs) {
    const key = normalizeTitle(tab.title);
    if (!key || tab.id == null) continue;
    const group = groups.get(key) ?? [];
    group.push(tab);
    groups.set(key, group);
  }

  const duplicateGroups = [...groups.values()].filter((group) => group.length > 1);
  const removeIds = [];
  const keepIds = [];

  for (const group of duplicateGroups) {
    const ranked = [...group].sort(compareKeepPriority);
    keepIds.push(ranked[0].id);
    removeIds.push(...ranked.slice(1).map((tab) => tab.id));
  }

  return { duplicateGroups, keepIds, removeIds };
}

function compareKeepPriority(a, b) {
  const lastAccessedDifference = (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0);
  if (lastAccessedDifference !== 0) return lastAccessedDifference;
  if (Boolean(a.active) !== Boolean(b.active)) return a.active ? -1 : 1;
  if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
  return (a.id ?? 0) - (b.id ?? 0);
}

export function matchesSearch(tab, query) {
  const needle = String(query ?? "").normalize("NFKC").trim().toLocaleLowerCase();
  if (!needle) return true;
  return `${tab.title ?? ""}\n${tab.url ?? ""}`.normalize("NFKC").toLocaleLowerCase().includes(needle);
}

export function getTabLabel(tab, fallback = "New tab") {
  try {
    const url = new URL(tab.url);
    if (INTERNAL_SCHEMES.has(url.protocol)) return url.protocol.replace(":", "");
    return url.hostname.replace(/^www\./, "") || fallback;
  } catch {
    return fallback;
  }
}

export function getTitlePreview(title, maxLength = 10, fallback = "Untitled") {
  const characters = Array.from(String(title || fallback));
  return characters.length > maxLength
    ? `${characters.slice(0, maxLength).join("")}…`
    : characters.join("");
}

export function getPreviousActiveTabId(history, currentTabId, tabs) {
  const liveIds = new Set(tabs.map((tab) => tab.id).filter((id) => id != null));
  const historicalMatch = history.find((id) => id !== currentTabId && liveIds.has(id));
  if (historicalMatch != null) return historicalMatch;

  const [mostRecent] = tabs
    .filter((tab) => tab.id != null && tab.id !== currentTabId)
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return mostRecent?.id ?? null;
}

export function getCurrentTabId(tabs, currentWindowId) {
  return tabs.find((tab) => tab.windowId === currentWindowId && tab.active)?.id ?? null;
}

export function getWindowGroups(tabs) {
  const groups = new Map();
  for (const tab of tabs) {
    const key = tab.windowId ?? -1;
    const group = groups.get(key) ?? [];
    group.push(tab);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([windowId, windowTabs]) => ({ windowId, tabs: windowTabs }));
}
