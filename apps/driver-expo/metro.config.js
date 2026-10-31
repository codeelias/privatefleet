const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const config = getDefaultConfig(__dirname);
// The workspace root contains the monorepo entry shim used by the release
// embed (index.ts at the repo root). Make sure Metro crawls it.
config.watchFolders = [__dirname, path.resolve(__dirname, "../..")];
module.exports = config;
