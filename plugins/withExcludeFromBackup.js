const { withAppDelegate } = require('@expo/config-plugins');

// Inlined directly — avoids having to find the right class closing brace
const EXCLUDE_CODE = `    if var docsUrl = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
      var resValues = URLResourceValues()
      resValues.isExcludedFromBackup = true
      try? docsUrl.setResourceValues(resValues)
    }
    `;

module.exports = function withExcludeFromBackup(config) {
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== 'swift') return mod;

    let contents = mod.modResults.contents;

    if (contents.includes('isExcludedFromBackup')) {
      return mod; // already applied
    }

    // Insert inline before the return in application(_:didFinishLaunchingWithOptions:)
    const returnPattern = /([ \t]*)(return super\.application\(application,\s*didFinishLaunchingWithOptions:\s*launchOptions\))/;
    if (!returnPattern.test(contents)) {
      console.warn('[withExcludeFromBackup] Could not find insertion point in AppDelegate.swift — skipping');
      return mod;
    }

    mod.modResults.contents = contents.replace(returnPattern, `${EXCLUDE_CODE}$1$2`);
    return mod;
  });
};
