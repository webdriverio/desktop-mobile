FROM ghcr.io/void-linux/void-glibc-full:latest

ENV CI=true

# Configure repository mirror to avoid SSL certificate issues
RUN mkdir -p /etc/xbps.d && \
    cp /usr/share/xbps.d/*-repository-*.conf /etc/xbps.d/ && \
    sed -i 's|https://[^/]*/|https://repo-default.voidlinux.org/|g' /etc/xbps.d/*-repository-*.conf

# Install basic requirements, after upgrading the image's packages so new ones install against current libraries
RUN xbps-install -Syu xbps && \
    xbps-install -uy && \
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

# Install Rust toolchain (needed for tauri-driver)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install Tauri runtime dependencies
# Note: libwebkit2gtk41 includes WebKitWebDriver at /usr/sbin/WebKitWebDriver
RUN xbps-install -y \
        libwebkit2gtk41 \
        libwebkit2gtk41-devel \
        gtk+3-devel \
        librsvg-devel \
        wget && \
    xbps-remove -O

# Ensure WebKitWebDriver is in /usr/bin (Void installs it in /usr/bin by default)
# Create symlink only if it's in /usr/sbin and not already in /usr/bin
RUN if [ -f /usr/sbin/WebKitWebDriver ] && [ ! -f /usr/bin/WebKitWebDriver ]; then \
      ln -s /usr/sbin/WebKitWebDriver /usr/bin/WebKitWebDriver; \
    fi

# Create test user with sudo access
RUN useradd -m -s /bin/bash testuser && \
    echo 'testuser ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# Verify WebKitWebDriver is available (via symlink)
RUN test -f /usr/bin/WebKitWebDriver

WORKDIR /app
USER testuser

CMD ["bash"]
