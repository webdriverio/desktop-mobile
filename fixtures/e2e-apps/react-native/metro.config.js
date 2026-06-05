const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro config for the RN E2E fixture.
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
