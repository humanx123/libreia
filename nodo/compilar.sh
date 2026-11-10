#!/usr/bin/env bash
# Compila LibreIA Nodo para Windows, Linux y macOS en nodo/dist/ (necesita Go 1.24 o superior).
# Si cambias el icono o la versión: go-winres simply --icon icono.png ... (ver README.md).
set -euo pipefail
cd "$(dirname "$0")"
rm -rf dist && mkdir -p dist
compilar() { # sistema arquitectura nombre
  CGO_ENABLED=0 GOOS=$1 GOARCH=$2 go build -trimpath -ldflags "-s -w" -o "dist/$3" .
  echo "  $3"
}
compilar windows amd64 LibreIA-Nodo.exe
compilar windows arm64 LibreIA-Nodo-windows-arm64.exe
compilar linux   amd64 LibreIA-Nodo-linux-x64
compilar linux   arm64 LibreIA-Nodo-linux-arm64
compilar darwin  arm64 LibreIA-Nodo-macos-arm64
compilar darwin  amd64 LibreIA-Nodo-macos-intel
(cd dist && sha256sum * > SHA256SUMS.txt)
cat dist/SHA256SUMS.txt
