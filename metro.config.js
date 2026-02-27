const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Disable Watchman to avoid FSEvents errors
config.resolver.useWatchman = false;

// lib/email and lib/slack use .js in imports for Node ESM in workers; Metro resolves to .ts when .js doesn't exist
const libRoot = path.resolve(__dirname, "lib");
const fs = require("fs");
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = context.originModulePath;
  if (origin && (origin.startsWith(libRoot + path.sep) || origin.startsWith(libRoot + "/")) && moduleName.startsWith(".")) {
    const ext = path.extname(moduleName);
    if (ext === ".js") {
      const dir = path.dirname(origin);
      const base = path.join(dir, path.basename(moduleName, ".js"));
      const tsPath = base + ".ts";
      const tsxPath = base + ".tsx";
      if (fs.existsSync(tsPath)) return { type: "sourceFile", filePath: tsPath };
      if (fs.existsSync(tsxPath)) return { type: "sourceFile", filePath: tsxPath };
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, {
  input: './global.css'
});
