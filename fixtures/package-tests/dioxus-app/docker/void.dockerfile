FROM ghcr.io/void-linux/void-glibc-full:latest

ENV CI=true

# With two mirrors, xbps skips one whose index fails to sync. bestmatching takes each package's newest
# version from either index, so while both are synced, Fastly's cache seldom pins an old one. xbps reads
# CONNECTION_TIMEOUT, in ms. The sed keeps each config's per-architecture path.
ARG CONNECTION_TIMEOUT=30000
RUN mkdir -p /etc/xbps.d && \
    cp /usr/share/xbps.d/*-repository-*.conf /etc/xbps.d/ && \
    sed -i 's|^repository=https://[^/]*/\(.*\)$|repository=https://repo-fastly.voidlinux.org/\1\nrepository=https://repo-default.voidlinux.org/\1|' \
        /etc/xbps.d/*-repository-*.conf && \
    echo 'bestmatching=true' >/etc/xbps.d/bestmatching.conf

# Install basic requirements, after upgrading the image's packages so new ones install against current libraries
# Void's nodejs tracks the current LTS line, which WDIO supports — sessions
# create fine on it (unlike Arch, which tracks the absolute newest Node whose
# stricter undici broke WDIO's session POST and therefore pins an LTS tarball).
RUN xbps-install -Syu xbps && \
    xbps-install -uy && \
    xbps-install -y \
        curl \
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

# Rust toolchain — compiles the Dioxus app, the embedded WebDriver and the
# bridge crate into the binary
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

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
#
# dejavu-fonts-ttf: nothing else here installs a font. Without one, GTK makes the
# Dioxus menubar so tall that the webview gets a 1px viewport, where WebKitGTK
# stops running requestAnimationFrame and Dioxus never applies its first render.
RUN xbps-install -y \
        libwebkit2gtk41 \
        libwebkit2gtk41-devel \
        gtk+3-devel \
        librsvg-devel \
        xdotool-devel \
        libayatana-appindicator \
        dejavu-fonts-ttf \
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
