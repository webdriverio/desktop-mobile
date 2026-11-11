# Maintenance Policy

How long each package and WebdriverIO version is supported in this monorepo.

## Supported Versions

Each package's latest major gets new features and fixes. Releases come from `main`.

### WebdriverIO

The current majors support WebdriverIO v9 (9.33.0+) and v10 (10.2.0+); their peer range is `^9.33.0 || ^10.2.0`. They support v9 until it leaves maintenance. WebdriverIO's [LTS](https://webdriver.io/versions) "typically guarantees that critical bugs will be fixed for a total of 12 months". The next major after that drops v9.

### Node.js

The packages need Node.js 22 (22.23.4+), 24 (24.22.1+) or 26 (26.12.1+), as their `engines` field says. Node.js 23 and 25 aren't supported. The range matches WebdriverIO's, and changes only in a major.

### Previous Majors

There are no maintenance branches. A critical or security fix for the previous major is backported only on request, and is released from that major's last tag. Open an issue to request one.

### Pre-releases and 0.x Packages

Packages on the `next` dist-tag (`-next.N` versions) and 0.x packages can change faster. In a 0.x package, a breaking change makes a minor release.

## Releases

Releases are versioned from conventional commits on `main`:

- **Patch:** bug fixes
- **Minor:** new features
- **Major:** breaking changes, such as dropping a WebdriverIO or Node.js version

Each major has release notes under its package's `docs/release-notes/` that list the breaking changes and how to migrate.

To pin a version, use an exact version (no `^` or `~`) in your `package.json`.

## Security

Report vulnerabilities privately, as [SECURITY.md](./SECURITY.md) describes.

## Questions

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [GitHub Discussions](https://github.com/webdriverio/desktop-mobile/discussions)
- [WebdriverIO Discord](https://discord.webdriver.io)
