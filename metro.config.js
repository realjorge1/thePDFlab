const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

config.resolver.alias = {
  ...config.resolver.alias,
  "@": path.resolve(__dirname),
};

if (!config.resolver.assetExts.includes("vlib")) {
  config.resolver.assetExts.push("vlib");
}

module.exports = config;
