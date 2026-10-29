/**
 * Debug-only Android network security config for the LAN pilot.
 *
 * Android does not trust user-installed CAs for app traffic by default. This
 * plugin adds a debug manifest overlay that trusts user CAs ONLY for debuggable
 * builds; release builds keep the platform default trust store. The Caddy
 * internal CA must be installed on the device before a debug install.
 *
 * Optional PF_DEBUG_CA_CERT copies a PEM CA into debug resources for emulator
 * verification; it is never referenced by release builds.
 */
const { withAppBuildGradle, withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const AUTOLINKING_PATCH = `
// Expo SDK 53 autolinking derives the Expo package import from the library
// Gradle namespace (\`expo.core\`) while the native class lives in
// \`expo.modules\`. Normalize the generated import for this local build.
tasks.configureEach { task ->
    if (task.name == "generateAutolinkingPackageList") {
        task.doLast {
            def packageList = file("$buildDir/generated/autolinking/src/main/java/com/facebook/react/PackageList.java")
            if (packageList.exists()) {
                packageList.text = packageList.text.replace(
                    "import expo.core.ExpoModulesPackage;",
                    "import expo.modules.ExpoModulesPackage;"
                )
            }
        }
    }
}
`;

const CONFIG_XML = (bundledCa) => `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">10.0.2.2</domain>
        <domain includeSubdomains="false">localhost</domain>
        <domain includeSubdomains="false">127.0.0.1</domain>
    </domain-config>
    <debug-overrides>
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
            ${bundledCa ? '<certificates src="@raw/caddy_root" />' : ""}
        </trust-anchors>
    </debug-overrides>
</network-security-config>
`;

const DEBUG_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:networkSecurityConfig="@xml/network_security_config" />
</manifest>
`;

module.exports = function withDebugNetworkSecurityConfig(config) {
  config = withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes("generateAutolinkingPackageList")) {
      cfg.modResults.contents += AUTOLINKING_PATCH;
    }
    return cfg;
  });
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const root = cfg.modRequest.platformProjectRoot;
      const debugXml = path.join(root, "app", "src", "debug", "res", "xml");
      fs.mkdirSync(debugXml, { recursive: true });
      const caPath = process.env.PF_DEBUG_CA_CERT;
      let bundledCa = false;
      if (caPath && fs.existsSync(caPath)) {
        const debugRaw = path.join(root, "app", "src", "debug", "res", "raw");
        fs.mkdirSync(debugRaw, { recursive: true });
        fs.copyFileSync(caPath, path.join(debugRaw, "caddy_root.crt"));
        bundledCa = true;
      }
      fs.writeFileSync(
        path.join(debugXml, "network_security_config.xml"),
        CONFIG_XML(bundledCa),
      );
      fs.writeFileSync(
        path.join(root, "app", "src", "debug", "AndroidManifest.xml"),
        DEBUG_MANIFEST,
      );
      return cfg;
    },
  ]);
};


