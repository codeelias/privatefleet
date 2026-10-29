/**
 * Debug-only Android network security config for the LAN pilot.
 *
 * Android does not trust user-installed CAs for app traffic by default. This
 * plugin adds a debug manifest overlay that trusts user CAs ONLY for debuggable
 * builds; release builds keep the platform default trust store. The Caddy
 * internal CA must be installed on the device before a debug install.
 */
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const CONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
    <debug-overrides>
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
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
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const root = cfg.modRequest.platformProjectRoot;
      const debugXml = path.join(root, "app", "src", "debug", "res", "xml");
      fs.mkdirSync(debugXml, { recursive: true });
      fs.writeFileSync(path.join(debugXml, "network_security_config.xml"), CONFIG_XML);
      fs.writeFileSync(
        path.join(root, "app", "src", "debug", "AndroidManifest.xml"),
        DEBUG_MANIFEST,
      );
      return cfg;
    },
  ]);
};

