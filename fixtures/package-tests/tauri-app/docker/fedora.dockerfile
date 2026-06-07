FROM fedora:40

ENV CI=true

# Install basic requirements INCLUDING xvfb for headless testing
RUN dnf install -y \
        curl \
        ca-certificates \
        sudo \
        git \
        gcc \
        gcc-c++ \
        make \
        pkg-config \
        openssl-devel \
        xorg-x11-server-Xvfb && \
    dnf clean all

# Node.js 24 LTS from NodeSource — the distro repo ships a pre-type-stripping
# node that can't run the workspace's bare-node .ts build scripts
RUN curl -fsSL https://rpm.nodesource.com/setup_24.x | bash - && \
    dnf install -y nodejs && \
    dnf clean all

# Install pnpm globally
RUN npm install -g pnpm

# Install Rust toolchain (needed for tauri-driver)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install Tauri runtime dependencies (webkit2gtk4.1 for Tauri)
RUN dnf install -y \
        webkit2gtk4.1-devel \
        libappindicator-gtk3-devel \
        librsvg2-devel \
        libxdo-devel \
        wget \
        file && \
    dnf clean all

# Install webkitgtk6.0 which provides WebKitWebDriver at /usr/bin/WebKitWebDriver
RUN dnf install -y webkitgtk6.0 && dnf clean all

# Create test user with sudo access
RUN useradd -m -s /bin/bash testuser && \
    echo 'testuser ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# Verify WebKitWebDriver is available
RUN test -f /usr/bin/WebKitWebDriver

WORKDIR /app
USER testuser

CMD ["bash"]
