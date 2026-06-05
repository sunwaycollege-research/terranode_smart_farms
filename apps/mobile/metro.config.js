// Metro config for the TERANODE monorepo.
// Lets Metro resolve workspace packages (@teranode/types, @teranode/agronomy)
// that live outside apps/mobile, and read hoisted node_modules at the repo root.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole monorepo so changes in packages/* trigger reloads.
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from the app first, then the hoisted root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. The shared packages publish "exports" pointing at TS source. SDK 55 enables
//    package exports by default; keep it explicit but don't override conditionNames
//    (overriding can break Expo packages that rely on Metro's default ordering).
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
