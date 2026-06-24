# Maintenance Policy

This document describes the maintenance and support policy for the WebdriverIO Desktop & Mobile Testing monorepo.

## No LTS / Backporting

This repository **does not maintain LTS or backport branches**. Each service receives updates only while on the `main` branch.

### What This Means

- ✅ **Latest versions on `main` receive all updates** - New features, bug fixes, and improvements
- ❌ **No backporting fixes to older major versions** - Once a new major version is released, the previous major version receives no further updates
- 📌 **Pin specific versions for stability** - Use exact versions in `package.json` if you need to avoid breaking changes
- 🔒 **Security fixes evaluated case-by-case** - Critical security issues may be considered for older versions at maintainer discretion

### Why This Approach

**Multi-service monorepo complexity:**
- Different services at different maturity levels (Electron v10, Tauri v1)
- Services evolve at different paces with different release cycles
- Backporting across multiple services would be complex and error-prone

**Resource optimization:**
- Focuses maintainer effort on moving forward rather than maintaining multiple versions
- Reduces testing and release overhead
- Allows faster iteration and innovation

**Aligns with project goals:**
- Agile development approach
- Rapid integration of new features
- Community-driven with limited maintainer bandwidth

### Comparison with Parent Project

The parent [WebdriverIO project](https://github.com/webdriverio/webdriverio) **does support LTS and backporting**:
- Maintains 2 major versions simultaneously
- Uses `backport-requested` labels for cherry-picking fixes
- Has dedicated maintenance branches (e.g., `v8.x`)

This difference is intentional and reflects:
- WebdriverIO core has larger team and user base
- desktop-mobile services are newer with smaller adoption
- Different resource availability

## Version Support Matrix

| Package | Status | Supported |
|---------|--------|-----------|
| @wdio/electron-service | Pre-release | ✅ Active |
| @wdio/tauri-service | Pre-release | ✅ Active |
| @wdio/native-utils | Stable | ✅ Active |
| @wdio/native-types | Stable | ✅ Active |
| @wdio/tauri-plugin | Pre-release | ✅ Active |

Check npm or each package's `package.json` for current version numbers.

**Legend:**
- ✅ Active - Receives all updates
- ⚠️ Security Only - Only critical security fixes (none currently)
- ❌ Unsupported - No longer maintained

## Best Practices for Users

### Pin Versions for Stability

If you need stability and want to avoid breaking changes, use exact versions (no `^` or `~`) in your `package.json` to prevent automatic updates.

### Stay Updated

For the latest features and fixes, use the `^` range prefix to allow compatible updates.

### Monitor Releases

- Watch the [CHANGELOG.md](./CHANGELOG.md) for updates
- Subscribe to [GitHub releases](https://github.com/webdriverio/desktop-mobile/releases)
- Check for breaking changes before upgrading major versions

## Release Cadence

- **Patch releases** - As needed for bug fixes
- **Minor releases** - When new features are added
- **Major releases** - Annually or when breaking changes accumulate

Pre-release packages (`-next.X`) may have more frequent updates during active development.

## Security Policy

While we don't backport general fixes, **security vulnerabilities are treated differently**:

1. Critical security issues in current versions are fixed immediately
2. Security issues in previous major versions are evaluated case-by-case
3. If feasible and impact is severe, security patches may be backported

To report security vulnerabilities, contact the maintainers privately (not via public issues).

## Migration Support

When major versions are released, we provide:

- **Migration guides** - Documentation of breaking changes
- **Deprecation warnings** - Advanced notice in previous versions when possible
- **Community support** - Help via Discord and Discussions

## Questions?

- See [CONTRIBUTING.md](./CONTRIBUTING.md) for general contribution guidelines
- Ask in [GitHub Discussions](https://github.com/webdriverio/desktop-mobile/discussions)
- Join [WebdriverIO Discord](https://discord.webdriver.io)
