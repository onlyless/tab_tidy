const INTERNAL_SCHEMES = new Set(["chrome:", "chrome-extension:", "edge:", "about:"]);

export function normalizeTitle(title) {
  return String(title ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

export function normalizeUrl(url) {
  try {
    const normalized = new URL(String(url ?? "").trim());
    normalized.hash = "";
    return normalized.href;
  } catch {
    return "";
  }
}

export function getDuplicatePlan(tabs) {
  const candidates = tabs.filter((tab) => tab.id != null);
  const remainingIds = new Set(candidates.map((tab) => tab.id));
  const duplicateGroups = [];
  const removeIds = [];
  const keepIds = new Set();

  // URL is the stronger page identity. It catches Edge tabs whose dynamic titles
  // differ, then title matching preserves the extension's original behavior.
  removeDuplicateGroups(groupTabs(candidates, getTabUrlKey), remainingIds, duplicateGroups, keepIds, removeIds);
  const remainingTabs = candidates.filter((tab) => remainingIds.has(tab.id));
  removeDuplicateGroups(groupTabs(remainingTabs, (tab) => normalizeTitle(tab.title)), remainingIds, duplicateGroups, keepIds, removeIds);

  return { duplicateGroups, keepIds: [...keepIds], removeIds };
}

function getTabUrlKey(tab) {
  return normalizeUrl(tab.url || tab.pendingUrl);
}

function groupTabs(tabs, getKey) {
  const groups = new Map();
  for (const tab of tabs) {
    const key = getKey(tab);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(tab);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function removeDuplicateGroups(groups, remainingIds, duplicateGroups, keepIds, removeIds) {
  for (const group of groups) {
    const ranked = [...group].sort(compareKeepPriority);
    const keptTab = ranked[0];
    duplicateGroups.push(group);
    keepIds.add(keptTab.id);
    for (const tab of ranked.slice(1)) {
      if (!remainingIds.delete(tab.id)) continue;
      keepIds.delete(tab.id);
      removeIds.push(tab.id);
    }
  }
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
  const visibleTitle = String(title ?? "")
    .replace(/[\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(visibleTitle || fallback);
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
