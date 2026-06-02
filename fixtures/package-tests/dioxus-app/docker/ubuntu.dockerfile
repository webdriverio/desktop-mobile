FROM ubuntu:24.04

# Avoid interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive
ENV CI=true

# Basic build tooling + Xvfb for headless GUI testing
RUN apt-get update -qq && \
    apt-get install -y \
        curl \
        ca-certificates \
        gnupg \
        sudo \
        git \
        build-essential \
        pkg-config \
        libssl-dev \
        xvfb && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install Node.js from NodeSource
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

# Install pnpm globally as root
RUN npm install -g pnpm

# Rust toolchain — compiles the Dioxus app, the embedded WebDriver and the
# bridge crate into the binary
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Dioxus desktop renders through Wry → WebKitGTK; these are the build deps.
# Unlike Tauri, the 'embedded' driver needs NO system WebKitWebDriver binary —
# the driver is compiled into the app — so webkit2gtk-driver is omitted.
RUN apt-get update -qq && \
    apt-get install -y \
        libwebkit2gtk-4.1-dev \
        libgtk-3-dev \
        libayatana-appindicator3-dev \
        librsvg2-dev \
        libxdo-dev \
        wget \
        file && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create test user with sudo access
RUN useradd -m -s /bin/bash testuser && \
    echo 'testuser ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# Verify the WebKitGTK build dependency is discoverable (Wry links against it)
RUN pkg-config --exists webkit2gtk-4.1

WORKDIR /app
USER testuser

# Default command
CMD ["bash"]
