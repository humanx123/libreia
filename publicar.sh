#!/usr/bin/env bash
# Publica LibreIA completo: web, APK firmada (release), Worker principal, panel y sitio.
# Uso: ./publicar.sh        (necesita el token de Cloudflare en ~/.wrangler/config/default.toml)
set -euo pipefail
cd "$(dirname "$0")"
export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-$(grep -oE 'cfat_[A-Za-z0-9]+' ~/.wrangler/config/default.toml | head -1)}"

echo "== 1/6 Web (vite)"; npx tsc --noEmit -p . && npm run build
echo "== 2/6 APK release firmada"
npx cap sync android
(cd android && ./gradlew assembleRelease -q)
APK=android/app/build/outputs/apk/release/app-release.apk
test -s "$APK"
# La APK va en los assets del Worker (no en public/: cap sync la metería dentro de la siguiente APK).
mkdir -p dist/descargas && cp "$APK" dist/descargas/LibreIA-Chat.apk
echo "== 3/6 Worker principal (API + web + descarga)"; npx wrangler deploy
echo "== 4/6 Panel de administración"; (cd admin && npx wrangler deploy)
echo "== 5/6 App web en Pages (sin la APK)"
TMP=$(mktemp -d); cp -r dist/. "$TMP"; rm -rf "$TMP/descargas"
npx wrangler pages deploy "$TMP" --project-name libre-ia --branch main --commit-dirty=true; rm -rf "$TMP"
echo "== 6/6 Sitio público (Cloudflare Pages)"
npx wrangler pages deploy landing --project-name libreia --branch main --commit-dirty=true
echo "LISTO"
