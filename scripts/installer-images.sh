#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/../src-tauri/icons"
logo=128x128@2x.png
magick -size 164x314 gradient:'#2f746b'-'#163a35' \( "$logo" -resize 112x112 \) -geometry +26+70 -composite \
  -type TrueColor -alpha off BMP3:nsis-sidebar.bmp
magick -size 150x57 xc:'#ffffff' \( "$logo" -resize 46x46 \) -geometry +98+5 -composite \
  -type TrueColor -alpha off BMP3:nsis-header.bmp
