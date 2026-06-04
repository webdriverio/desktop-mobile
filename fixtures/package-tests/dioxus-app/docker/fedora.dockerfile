FROM fedora:40

ENV CI=true

# Install basic requirements INCLUDING Xvfb for headless testing
RUN dnf install -y \
        curl \
        ca-certificates \
        sudo \
        git \
        nodejs \
        npm \
        gcc \
        gcc-c++ \
        make \
        pkg-config \
        openssl-devel \
        xorg-x11-server-Xvfb && \
    dnf clean all

# Install pnpm globally
RUN npm install -g pnpm

# Rust toolchain — compiles the Dioxus app, the embedded WebDriver and the
# bridge crate into the binary
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Dioxus desktop renders through Wry → WebKitGTK; these are the build deps.
# The 'embedded' driver needs NO system WebKitWebDriver binary, so webkitgtk6.0
# (which would only provide that binary) is omitted.
RUN dnf install -y \
        webkit2gtk4.1-devel \
        gtk3-devel \
        libappindicator-gtk3-devel \
        librsvg2-devel \
        libxdo-devel \
        mesa-dri-drivers \
        wget \
        file && \
    dnf clean all

# Create test user with sudo access
RUN useradd -m -s /bin/bash testuser && \
    echo 'testuser ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# Verify the WebKitGTK build dependency is discoverable (Wry links against it)
RUN pkg-config --exists webkit2gtk-4.1

WORKDIR /app
USER testuser

CMD ["bash"]
