const { withAppDelegate } = require('@expo/config-plugins');

const EXCLUDE_FUNCTION = `
  private func excludeDocumentsFromiCloudBackup() {
    let fm = FileManager.default
    let dirs = fm.urls(for: .documentDirectory, in: .userDomainMask)
    guard var url = dirs.first else { return }
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? url.setResourceValues(values)
  }
`;

const EXCLUDE_CALL = '    excludeDocumentsFromiCloudBackup()\n';

module.exports = function withExcludeFromBackup(config) {
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== 'swift') return mod;

    let contents = mod.modResults.contents;

    if (contents.includes('excludeDocumentsFromiCloudBackup')) {
      return mod; // already applied
    }

    // Insert the call before the return in application(_:didFinishLaunchingWithOptions:)
    const returnPattern = /([ \t]*)(return super\.application\(application,\s*didFinishLaunchingWithOptions:\s*launchOptions\))/;
    if (!returnPattern.test(contents)) {
      console.warn('[withExcludeFromBackup] Could not find insertion point in AppDelegate.swift — skipping');
      return mod;
    }
    contents = contents.replace(returnPattern, `${EXCLUDE_CALL}$1$2`);

    // Insert the helper method before the last closing brace of the class
    const lastBrace = contents.lastIndexOf('\n}');
    if (lastBrace !== -1) {
      contents = contents.slice(0, lastBrace) + EXCLUDE_FUNCTION + contents.slice(lastBrace);
    }

    mod.modResults.contents = contents;
    return mod;
  });
};
