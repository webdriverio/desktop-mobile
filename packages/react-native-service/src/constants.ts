/** Logger namespace for this service (`createLogger(SERVICE_NAME, '<module>')`). */
export const SERVICE_NAME = 'react-native-service';

/** WDIO capability key carrying per-capability service options. */
export const CUSTOM_CAPABILITY_NAME = 'wdio:reactNativeServiceOptions';

/** Default host of the Metro inspector-proxy used for the Hermes CDP attach. */
export const DEFAULT_METRO_HOST = 'localhost';

/** Default port of the Metro inspector-proxy (Metro's standard bundler port). */
export const DEFAULT_METRO_PORT = 8081;

/**
 * Discovery budget for the Hermes inspector attach. Hermes registers its target
 * with Metro's inspector-proxy a few seconds *after* the JS bundle loads (longer
 * on a cold emulator/first launch), so the CdpBridge default (3 × 100ms ≈ 300ms)
 * gives up long before the target appears in `/json/list`. Poll for ~60s instead:
 * the New Architecture (Fabric/bridgeless) registers later than Paper (the probe
 * saw `/json/list` populate at ~24s), and GitHub-hosted macOS runners are slower
 * under load, so a full minute of headroom keeps the new-arch iOS leg non-flaky.
 */
export const HERMES_CONNECT_RETRIES = 60;
export const HERMES_CONNECT_INTERVAL_MS = 1000;
