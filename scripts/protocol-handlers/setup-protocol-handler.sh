#!/bin/bash
# Generic protocol handler setup script for Linux
# Idempotent: safe to run multiple times
#
# Usage: setup-protocol-handler.sh <app-dir> <executable-name> <search-paths> <desktop-file-basename> <app-display-name>
# Example: setup-protocol-handler.sh . electron-builder-e2e-app "dist-electron/linux-unpacked,dist-electron/linux-x64-unpacked" "electron-builder-e2e-app-testapp" "Electron Builder E2E Test App"

set -e

APP_DIR="${1:-}"
EXECUTABLE_NAME="${2:-}"
SEARCH_PATHS_STR="${3:-}"
DESKTOP_FILE_BASENAME="${4:-}"
APP_DISPLAY_NAME="${5:-}"

if [ -z "$APP_DIR" ] || [ -z "$EXECUTABLE_NAME" ] || [ -z "$SEARCH_PATHS_STR" ] || [ -z "$DESKTOP_FILE_BASENAME" ] || [ -z "$APP_DISPLAY_NAME" ]; then
    echo "Error: Missing required arguments"
    echo "Usage: $0 <app-dir> <executable-name> <search-paths> <desktop-file-basename> <app-display-name>"
    exit 1
fi

PROTOCOL_NAME="testapp"

echo "Setting up ${PROTOCOL_NAME}:// protocol handler..."
echo "App directory: $APP_DIR"

if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "Platform: Linux"

    # Convert comma-separated search paths to array
    IFS=',' read -ra SEARCH_PATHS_ARRAY <<< "$SEARCH_PATHS_STR"

    # Build full search paths
    FULL_SEARCH_PATHS=()
    for path in "${SEARCH_PATHS_ARRAY[@]}"; do
        FULL_SEARCH_PATHS+=("$APP_DIR/$path/$EXECUTABLE_NAME")
    done

    APP_EXECUTABLE=""
    for path in "${FULL_SEARCH_PATHS[@]}"; do
        if [ -f "$path" ] && [ -x "$path" ]; then
            APP_EXECUTABLE="$path"
            break
        fi
    done

    # Fallback: search recursively if not found in expected locations
    if [ -z "$APP_EXECUTABLE" ]; then
        echo "Searching recursively for executable..."
        # Get the base search directory (first path component)
        BASE_DIR=$(echo "$SEARCH_PATHS_STR" | cut -d',' -f1 | cut -d'/' -f1)
        APP_EXECUTABLE=$(find "$APP_DIR/$BASE_DIR" -name "$EXECUTABLE_NAME" -type f -executable 2>/dev/null | head -n 1)
    fi

    if [ -z "$APP_EXECUTABLE" ]; then
        echo "Error: Could not find $EXECUTABLE_NAME executable"
        echo "Searched paths:"
        for path in "${FULL_SEARCH_PATHS[@]}"; do
            echo "  - $path"
        done
        exit 1
    fi

    echo "Found executable: $APP_EXECUTABLE"

    # IDEMPOTENCY CHECK: Check if protocol handler is already registered
    if command -v xdg-mime &> /dev/null; then
        CURRENT_HANDLER=$(xdg-mime query default x-scheme-handler/${PROTOCOL_NAME} 2>/dev/null || echo "")
        if [ "$CURRENT_HANDLER" = "${DESKTOP_FILE_BASENAME}.desktop" ]; then
            echo "Protocol handler already registered correctly (handler: $CURRENT_HANDLER), skipping..."
            exit 0
        fi
        echo "Current handler: $CURRENT_HANDLER, will update to: ${DESKTOP_FILE_BASENAME}.desktop"
    fi

    # Create .desktop file for protocol handler
    DESKTOP_FILE="$HOME/.local/share/applications/${DESKTOP_FILE_BASENAME}.desktop"
    mkdir -p "$(dirname "$DESKTOP_FILE")"

    cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Name=$APP_DISPLAY_NAME
Comment=Test application for protocol handler E2E tests
Exec=env ENABLE_SINGLE_INSTANCE=true "$APP_EXECUTABLE" %u
Terminal=false
Type=Application
Categories=Utility;
MimeType=x-scheme-handler/${PROTOCOL_NAME};
EOF

    echo "Created .desktop file: $DESKTOP_FILE"

    # Update desktop database (with timeout to prevent hanging)
    if command -v update-desktop-database &> /dev/null; then
        timeout 10 update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || echo "Warning: update-desktop-database timed out or failed"
    else
        echo "Warning: update-desktop-database not found, skipping"
    fi

    # Register the protocol handler (with timeout to prevent hanging)
    if command -v xdg-mime &> /dev/null; then
        timeout 10 xdg-mime default "${DESKTOP_FILE_BASENAME}.desktop" x-scheme-handler/${PROTOCOL_NAME}
        echo "Registered ${PROTOCOL_NAME}:// protocol handler"

        # Verify registration
        HANDLER=$(timeout 10 xdg-mime query default x-scheme-handler/${PROTOCOL_NAME})
        echo "Current handler for ${PROTOCOL_NAME}://: $HANDLER"
    else
        echo "Error: xdg-mime not found, cannot register protocol handler"
        exit 1
    fi

elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo "Platform: macOS"
    echo "Protocol handler registration on macOS is handled by the app itself via setAsDefaultProtocolClient"
    echo "No additional setup required"
else
    echo "Unsupported platform: $OSTYPE"
    exit 1
fi

echo "Setup complete!"
