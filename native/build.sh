#!/bin/sh
# Builds the native Spotify audio tap. Requires Xcode Command Line Tools (swiftc).
set -e
cd "$(dirname "$0")"
swiftc -O -framework CoreAudio -framework AudioToolbox -framework AppKit SpotifyTap.swift -o spotifytap
echo "built native/spotifytap"
