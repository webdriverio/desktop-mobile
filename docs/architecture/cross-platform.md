# Cross-Platform Process Handling

Current desktop platforms: `win32`, `darwin`, `linux`. Mobile (`ios`, `android`) planned via Appium (see ROADMAP.md).

## Platform Guards
Use `process.platform` checks at the boundaries (launcher, binary discovery), not deep in business logic.

```typescript
const isWindows = process.platform === 'win32';
const command = isWindows ? 'where tauri-driver' : 'which tauri-driver';
```

## Windows-Specific
- Binary names need `.exe` / `.cmd` suffixes
- Convert Git Bash paths (`/c/Users/...`) to Windows paths (`C:\Users\...`)
- Use `process.env.USERPROFILE` instead of `HOME`
- Shell scripts require `.cmd` wrappers

## Linux-Specific
- Data directory isolation via `XDG_DATA_HOME` env var
- Check `DISPLAY` env var for headless environments
- Platform-specific workarounds (e.g. AppArmor on Ubuntu 24.04+) should follow the discovery chain pattern: detect issue -> attempt auto-fix -> fallback to manual instructions with install commands
- Detect package manager for install guidance (`apt`, `dnf`, `pacman`, etc.)

## macOS-Specific
- Data directory isolation via `TAURI_DATA_DIR` env var (framework-specific)
- Some drivers require third-party providers (e.g. CrabNebula for Tauri macOS)
- Use `/opt/homebrew/bin/` as common binary location

## File Paths
- Use `node:path` (`join`, `dirname`) for all path construction
- Never hardcode `/` or `\` separators
