FROM ubuntu:24.04

# Avoid interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive
ENV CI=true

# Install basic requirements and build tools INCLUDING webkit2gtk-driver and xvfb
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
        webkit2gtk-driver \
        xvfb && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install Node.js from NodeSource
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y nodejs

# Install pnpm globally as root
RUN npm install -g pnpm

# Install Rust toolchain (needed for tauri-driver)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install Tauri build dependencies
RUN apt-get update -qq && \
    apt-get install -y \
        libwebkit2gtk-4.1-dev \
        libxdo-dev \
        libayatana-appindicator3-dev \
        librsvg2-dev \
        libxcb-shape0-dev \
        libxcb-xfixes0-dev \
        wget \
        file && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create test user with sudo access
RUN useradd -m -s /bin/bash testuser && \
    echo 'testuser ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# Verify WebKitWebDriver IS available
RUN which WebKitWebDriver

WORKDIR /app
USER testuser

# Default command
CMD ["bash"]
