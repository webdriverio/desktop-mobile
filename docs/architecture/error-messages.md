# Error Messages

All user-facing error messages must be actionable.

## Structure
1. **What went wrong** — Specific, not generic
2. **What to do** — Concrete fix steps
3. **Link to docs** — When applicable

## Example
```typescript
// Good
new Error(
  'Could not find Electron app built with Electron Forge!\n' +
  'If the application is not compiled, please do so before running your tests:\n' +
  '  npx electron-forge make\n' +
  'Otherwise specify the `appBinaryPath` option in your capabilities.'
);

// Bad
new Error('Binary not found');
```

## Rules
- Include install/fix commands users can copy-paste
- Reference specific config option names (e.g. `appBinaryPath`, `autoInstallTauriDriver`)
- Include platform context when relevant ("on Windows, use...")
- For version mismatches, show both versions (expected vs actual)
- Never show raw stack traces to users — log full error server-side, return clean message
- Always chain the original error via `cause` for debugging
- Include structured context when available (binary path, port, version)

## Launcher Errors
Use `SevereServiceError` (from `webdriverio`) in launcher hooks for critical failures that should stop the test runner. Do not use `SevereServiceError` in worker-side code.
