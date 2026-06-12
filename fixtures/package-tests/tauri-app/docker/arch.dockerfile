FROM archlinux:latest

ENV CI=true

# Update package database and install basic requirements.
# Note: Node.js is NOT installed from pacman — Arch's `nodejs` package tracks
# the latest release (currently Node 26) whose stricter undici validation
# trips WDIO's session POST (UND_ERR_INVALID_ARG). We install Node 24 LTS
# from official binaries below to match Ubuntu/Debian (which pin via
# setup_24.x) and keep builds repeatable.
RUN pacman -Syu --noconfirm && \
    pacman -S --noconfirm \
        curl \
        ca-certificates \
        sudo \
        git \
        base-devel \
        openssl \
        python \
        xorg-server-xvfb && \
    pacman -Scc --noconfirm

# Install Node.js 24 LTS from official binaries (pinned for repeatable builds)
RUN NODE_VERSION="24.11.0" && \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
        -o /tmp/node.tar.xz && \
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 && \
    rm /tmp/node.tar.xz && \
    node --version && npm --version

# Install Rust toolchain (needed for tauri-driver)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install Tauri runtime dependencies (webkit2gtk-4.1 for Tauri)
RUN pacman -S --noconfirm \
        webkit2gtk-4.1 \
        libappindicator-gtk3 \
        librsvg \
        xdotool \
        wget \
        file && \
    pacman -Scc --noconfirm

# Install webkitgtk-6.0 which provides WebKitWebDriver at /usr/bin/WebKitWebDriver
RUN pacman -S --noconfirm webkitgtk-6.0 && pacman -Scc --noconfirm

# Create test user with sudo access
RUN useradd -m -s /bin/bash testuser && \
    echo 'testuser ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# Verify WebKitWebDriver is available
RUN test -f /usr/bin/WebKitWebDriver

WORKDIR /app
USER testuser

CMD ["bash"]
