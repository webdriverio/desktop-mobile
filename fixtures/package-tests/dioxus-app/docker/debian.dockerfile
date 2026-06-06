FROM debian:12

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

# Install Node.js 20.x
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install pnpm globally
RUN npm install -g pnpm

# Rust toolchain — compiles the Dioxus app, the embedded WebDriver and the
# bridge crate into the binary
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Dioxus desktop renders through Wry → WebKitGTK; these are the build deps.
# The 'embedded' driver needs NO system WebKitWebDriver binary, so
# webkit2gtk-driver is omitted.
RUN apt-get update && \
    apt-get install -y \
        libwebkit2gtk-4.1-dev \
        libgtk-3-dev \
        libayatana-appindicator3-dev \
        librsvg2-dev \
        libxdo-dev \
        libgl1-mesa-dri \
        wget \
        file \
        xvfb && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create test user with sudo access
RUN useradd -m -s /bin/bash testuser && \
    echo 'testuser ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# Verify the WebKitGTK build dependency is discoverable (Wry links against it)
RUN pkg-config --exists webkit2gtk-4.1

WORKDIR /app
USER testuser

CMD ["bash"]
