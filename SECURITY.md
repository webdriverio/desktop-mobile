# Security Policy

## Reporting a Vulnerability

**Do not report security vulnerabilities through public GitHub issues.**

Use [GitHub Security Advisories](https://github.com/webdriverio/desktop-mobile/security/advisories) to report privately, or reach out via the [WebdriverIO Discord](https://discord.webdriver.io).

Include: description, steps to reproduce, affected packages, and suggested fix if any.

## Out of Scope

This project is a testing framework, not production runtime software. The following are not security vulnerabilities:

- Issues in applications being tested
- Local privilege escalation during test execution (tests run with user privileges by design)
- Information disclosure in test logs (test output is controlled by the user)
- CDP/WebDriver protocol exposure during test runs (this is how the tools work)

## Best Practices for Users

- Do not commit test artifacts containing sensitive data
- Avoid real credentials in mock configurations — use `CN_API_KEY` and similar secrets via environment variables, never in config files
- Ensure test environments are isolated from production
- Only test application binaries from trusted sources

## Dependency Security

Dependabot, CodeQL, and `pnpm audit` run in CI. Dependency vulnerabilities are addressed based on severity in the next appropriate release.
