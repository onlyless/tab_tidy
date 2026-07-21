export function getMessage(i18nApi, key, substitutions) {
  return i18nApi.getMessage(key, substitutions) || key;
}

export function localizeDocument(root, i18nApi) {
  root.documentElement.lang = i18nApi.getMessage("@@ui_locale").replace("_", "-") || "en";

  for (const element of root.querySelectorAll("[data-i18n]")) {
    element.textContent = getMessage(i18nApi, element.dataset.i18n);
  }
  for (const element of root.querySelectorAll("[data-i18n-title]")) {
    element.title = getMessage(i18nApi, element.dataset.i18nTitle);
  }
  for (const element of root.querySelectorAll("[data-i18n-placeholder]")) {
    element.placeholder = getMessage(i18nApi, element.dataset.i18nPlaceholder);
  }
  for (const element of root.querySelectorAll("[data-i18n-aria-label]")) {
    element.setAttribute("aria-label", getMessage(i18nApi, element.dataset.i18nAriaLabel));
  }
}
