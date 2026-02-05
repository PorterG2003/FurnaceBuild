const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Disable Watchman to avoid FSEvents errors
config.resolver.useWatchman = false;

module.exports = withNativeWind(config, {
  input: './global.css'
});
