/** The reference's import summary: actual counts on success, specific guidance on failure. */
export function importSummary(result, t) {
  const fill = (text, values) => Object.entries(values).reduce((value, [key, count]) => value.replaceAll(`{${key}}`, String(count)), text);
  if (!result.success) return t({ chrome_profile_not_found: 'importNotFound', chrome_default_profile_not_found: 'importNotFound', chrome_executable_not_found: 'importNoChrome',
    chrome_cookie_access_denied: 'importDenied', chrome_profile_locked: 'importLocked', chrome_cookie_protection_unsupported: 'importProtected',
    chrome_local_storage_import_failed: 'importStorageFailed' }[result.error] ?? 'importUnavailable');
  const values = { cookies: result.cookies?.imported ?? 0, origins: result.localStorage?.originsImported ?? 0, entries: result.localStorage?.entriesImported ?? 0, skipped: result.cookies?.skipped ?? 0 };
  if (result.issues?.includes('chrome_local_storage_import_failed')) return fill(t('importPartialStorage'), values);
  return fill(t(values.skipped ? 'importSummarySkipped' : 'importSummary'), values);
}
