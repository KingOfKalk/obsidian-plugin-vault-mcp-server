FROM ubuntu:24.04

ARG OBSIDIAN_VERSION=1.8.9
ARG NODE_MAJOR=20

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    SCREEN_WIDTH=1920 \
    SCREEN_HEIGHT=1080 \
    SCREEN_DEPTH=24

# System packages: Xvfb, window manager, screenshot & diff tools, Electron deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Virtual framebuffer & window manager
    xvfb \
    fluxbox \
    # Screenshot & image comparison
    imagemagick \
    scrot \
    # Electron / Obsidian runtime dependencies
    libgtk-3-0 \
    libnotify4 \
    libnss3 \
    libxss1 \
    libasound2t64 \
    libsecret-1-0 \
    xdg-utils \
    libgbm1 \
    libdrm2 \
    libx11-xcb1 \
    libxcb-dri3-0 \
    libxshmfence1 \
    # Utility
    curl \
    wget \
    ca-certificates \
    gnupg \
    unzip \
    git \
    jq \
    dbus \
    dbus-x11 \
    x11-utils \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Download Obsidian AppImage
RUN wget -q "https://github.com/obsidianmd/obsidian-releases/releases/download/v${OBSIDIAN_VERSION}/Obsidian-${OBSIDIAN_VERSION}.AppImage" \
        -O /opt/Obsidian.AppImage \
    && chmod +x /opt/Obsidian.AppImage \
    # Extract AppImage (FUSE is unavailable in Docker)
    && cd /opt && /opt/Obsidian.AppImage --appimage-extract \
    && ln -s /opt/squashfs-root/obsidian /usr/local/bin/obsidian

# Create non-root user
RUN useradd -ms /bin/bash obsidian
USER obsidian
WORKDIR /home/obsidian

# Pre-create Obsidian config to skip first-run wizard
RUN mkdir -p /home/obsidian/.config/obsidian \
    && echo '{}' > /home/obsidian/.config/obsidian/obsidian.json

# Working directories
RUN mkdir -p /home/obsidian/plugin \
             /home/obsidian/vault \
             /home/obsidian/screenshots/baseline \
             /home/obsidian/screenshots/current \
             /home/obsidian/screenshots/diff

COPY --chown=obsidian:obsidian entrypoint.sh /home/obsidian/entrypoint.sh
COPY --chown=obsidian:obsidian scripts/ /home/obsidian/scripts/

ENTRYPOINT ["/home/obsidian/entrypoint.sh"]
CMD ["bash"]
