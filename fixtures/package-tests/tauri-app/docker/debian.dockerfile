FROM debian:13

ENV DEBIAN_FRONTEND=noninteractive
ENV CI=true

# Install basic requirements
RUN apt-get update && \
    apt-get install -y \
        curl \
        ca-certificates \
        sudo \
        git \
        gnupg \
        build-essential \
        pkg-config \
        libssl-dev && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install Node.js 24.x
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install Rust toolchain (needed for tauri-driver)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install Tauri runtime dependencies, webkit2gtk-driver, and xvfb
RUN apt-get update && \
    apt-get install -y \
        libwebkit2gtk-4.1-dev \
        libxdo-dev \
        libayatana-appindicator3-dev \
        librsvg2-dev \
        libxcb-shape0-dev \
        libxcb-xfixes0-dev \
        wget \
        file \
        webkit2gtk-driver \
        xvfb && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create test user with sudo access
RUN useradd -m -s /bin/bash testuser && \
    echo 'testuser ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# Verify WebKitWebDriver IS available
RUN which WebKitWebDriver || ls -la /usr/lib/*/webkit2gtk*/WebKitWebDriver

WORKDIR /app
USER testuser

CMD ["bash"]
