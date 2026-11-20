FROM rust:1-trixie
RUN apt-get update && apt-get install -y --no-install-recommends nsis lld llvm clang curl ca-certificates xz-utils \
    libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
 && rm -rf /var/lib/apt/lists/*
ARG NODE_SHA256=71a04f4b9144870c9407b8019fe912514229e50246bc706862eded3ac8e9025d
RUN curl -fsSLo /tmp/node.tar.xz https://nodejs.org/dist/v22.21.0/node-v22.21.0-linux-x64.tar.xz  && echo "$NODE_SHA256  /tmp/node.tar.xz" | sha256sum -c -  && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 && rm /tmp/node.tar.xz
RUN rustup target add x86_64-pc-windows-msvc && rustup component add clippy rustfmt \
 && cargo install --locked cargo-xwin
ENV XWIN_ACCEPT_LICENSE=1 XWIN_CACHE_DIR=/cache/xwin CARGO_HOME=/usr/local/cargo
WORKDIR /src
