FROM voidlinux/voidlinux:latest

ENV CI=true

# Configure repository mirror to avoid SSL certificate issues
RUN mkdir -p /etc/xbps.d && \
    cp /usr/share/xbps.d/*-repository-*.conf /etc/xbps.d/ && \
    sed -i 's|https://[^/]*/|https://repo-default.voidlinux.org/|g' /etc/xbps.d/*-repository-*.conf

# Install basic requirements (upgrade system deps to avoid conflicts, ignore failures in base-files)
RUN xbps-install -Syu xbps && \
    ( xbps-install -Su || true ) && \
    xbps-install -y \
        curl \
        ca-certificates \
        sudo \
        git \
        bash \
        nodejs \
        gcc \
        make \
        pkg-config \
        openssl-devel \
        xorg-server-xvfb && \
    xbps-remove -O

# Install pnpm globally
RUN npm install -g pnpm

# Rust toolchain — compiles the Dioxus app, the embedded WebDriver and the
# bridge crate into the binary
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Upgrade util-linux packages first to avoid dependency conflicts
RUN xbps-install -yf util-linux util-linux-common libblkid libuuid libmount libfdisk libsmartcols || true

# Dioxus desktop renders through Wry → WebKitGTK; these are the build deps.
# The 'embedded' driver needs NO system WebKitWebDriver binary, so no
# /usr/sbin/WebKitWebDriver symlink dance is required.
#
# Unlike the other four images, no separate libappindicator / xdotool packages
# are installed. dioxus-desktop pulls muda/tray-icon/libxdo into the graph, but
# on Void those FFI deps resolve from the webkit2gtk41 + gtk+3 stack — the
# sibling Tauri Void image builds the identical crate graph green with exactly
# these packages, so adding more would only diverge from that proven reference.
RUN xbps-install -y \
        libwebkit2gtk41 \
        libwebkit2gtk41-devel \
        gtk+3-devel \
        librsvg-devel \
        mesa-dri \
        wget && \
    xbps-remove -O

# Create test user with sudo access
RUN useradd -m -s /bin/bash testuser && \
    echo 'testuser ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# Verify the WebKitGTK build dependency is discoverable (Wry links against it)
RUN pkg-config --exists webkit2gtk-4.1

WORKDIR /app
USER testuser

CMD ["bash"]
