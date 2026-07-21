import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getMessage } from "../lib/i18n.js";

const root = new URL("../", import.meta.url);

test("English and Chinese catalogs expose the same message keys", async () => {
  const [english, chinese] = await Promise.all([
    readJson("_locales/en/messages.json"),
    readJson("_locales/zh_CN/messages.json")
  ]);
  assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
});

test("every popup and manifest localization key exists in both catalogs", async () => {
  const [html, script, manifestText, english, chinese] = await Promise.all([
    readText("popup.html"),
    readText("popup.js"),
    readText("manifest.json"),
    readJson("_locales/en/messages.json"),
    readJson("_locales/zh_CN/messages.json")
  ]);
  const references = new Set([
    ...collect(html, /data-i18n(?:-title|-placeholder|-aria-label)?="([A-Za-z0-9_]+)"/g),
    ...collect(script, /\bt\("([A-Za-z0-9_]+)"/g),
    ...collect(manifestText, /__MSG_([A-Za-z0-9_]+)__/g)
  ]);
  for (const key of references) {
    assert.ok(english[key], `missing English key: ${key}`);
    assert.ok(chinese[key], `missing Chinese key: ${key}`);
  }
});

test("getMessage returns localized text and a visible fallback", () => {
  const api = { getMessage: (key) => key === "known" ? "Localized" : "" };
  assert.equal(getMessage(api, "known"), "Localized");
  assert.equal(getMessage(api, "missing"), "missing");
});

async function readText(path) {
  return readFile(new URL(path, root), "utf8");
}

async function readJson(path) {
  return JSON.parse(await readText(path));
}

function collect(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}
