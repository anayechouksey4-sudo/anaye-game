// Metro config: the app imports the wire protocol straight from ../shared (single source of truth),
// so Metro has to watch that folder too. Everything else is Expo's default.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../shared');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...new Set([...(config.watchFolders ?? []), sharedRoot])];

// shared/ has no node_modules of its own (protocol.ts is dependency-free); make sure any bare import
// from there would still resolve against this app's node_modules instead of walking up the tree.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

module.exports = config;
