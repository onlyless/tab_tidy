# Tab Tidy

**English** | [简体中文](README.zh-CN.md)

A zero-build Chrome Manifest V3 extension for finding, organizing, deduplicating, and closing tabs.

## Features

- Detect duplicate tabs by normalized page URL or title and clean them in one click. The most recently accessed duplicate is retained; inactive older copies are closed first. Active and pinned states only break access-time ties.
- Browse tabs across every Chrome window using three views:
  - **Default:** favicon plus the first 10 title characters.
  - **Icons only:** a high-density favicon grid with full titles on hover.
  - **Icon + title:** a detailed list.
- Search titles and URLs instantly.
- Select individual tabs or all search results, then close them in bulk.
- Click any tab card to focus its Chrome window and activate the tab.
- Drag a tab card onto another window section to move it there, including collapsed window sections.
- Collapse and expand each browser window independently.
- Automatically locate and briefly highlight the active tab when the popup opens.
- Automatically focus the search field when the popup opens, so typing can begin immediately after using the shortcut.
- Use keyboard shortcuts to open the extension or switch to the previously used tab. Repeating the latter toggles quickly between the two most recent tabs.
- Automatically follows the Chrome UI language in English and Simplified Chinese.

## Keyboard shortcuts

Click **Shortcuts** in the extension to open Chrome's native shortcut settings. You can configure both **Activate the extension** and **Switch to the previously used tab**. Chrome does not allow extensions to assign user shortcuts directly.

## Install from source

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository's directory.

## Test

```bash
npm test
```

## Deduplication rules

Exact page URLs are matched first (URL fragments are ignored), which also detects Edge tabs whose dynamic titles differ. Titles are then Unicode-normalized, whitespace is collapsed, and letter case is ignored. Tabs with the same normalized title are still considered duplicates even when their URLs differ.

Chrome does not expose a tab creation timestamp to extensions, so Tab Tidy uses Chrome's `lastAccessed` value as the reliable definition of “most recent.”

## Privacy

Tab Tidy processes tab metadata locally in Chrome. It does not send browsing data to an external service.
