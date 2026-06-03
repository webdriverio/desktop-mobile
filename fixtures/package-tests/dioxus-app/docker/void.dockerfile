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
# xdotool-devel provides the unversioned libxdo.so: muda (dioxus-desktop's
# menu crate) hard-links `-lxdo`, and without it the app's final link fails
# ("unable to find library -lxdo"). The other images get it from their
# distro's xdotool/libxdo devel packages. libayatana-appindicator is the
# runtime tray library tray-icon dlopens (it probes the ayatana name first);
# not needed at link time, installed for runtime parity with the other images.
RUN xbps-install -y \
        libwebkit2gtk41 \
        libwebkit2gtk41-devel \
        gtk+3-devel \
        librsvg-devel \
        xdotool-devel \
        libayatana-appindicator \
        mesa-dri \
        wget \
        file && \
    xbps-remove -O

# Create test user with sudo access
RUN useradd -m -s /bin/bash testuser && \
    echo 'testuser ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# Verify the WebKitGTK build dependency is discoverable (Wry links against it)
RUN pkg-config --exists webkit2gtk-4.1

WORKDIR /app
USER testuser

CMD ["bash"]
