FROM rust:1-trixie
RUN apt-get update && apt-get install -y --no-install-recommends nsis lld llvm clang curl ca-certificates xz-utils \
    libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://nodejs.org/dist/v22.21.0/node-v22.21.0-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1
RUN rustup target add x86_64-pc-windows-msvc && rustup component add clippy rustfmt \
 && cargo install --locked cargo-xwin
ENV XWIN_ACCEPT_LICENSE=1 XWIN_CACHE_DIR=/cache/xwin CARGO_HOME=/usr/local/cargo
WORKDIR /src
