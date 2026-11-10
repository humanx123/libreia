#!/usr/bin/env bash
# Genera el kit de difusión de LibreIA a partir de plantilla.html (Chrome sin interfaz).
#   ./promo/generar.sh            → promo/kit/… y promo/LibreIA-kit-difusion.zip
# Requisitos: python3 (servidor local) y chrome-headless-shell (Playwright) o CHROME=/ruta/al/chrome.
set -euo pipefail
cd "$(dirname "$0")/.."
RAIZ=$(pwd)
KIT=promo/kit
CHROME=${CHROME:-$(ls /root/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell 2>/dev/null | head -1)}
[ -x "$CHROME" ] || { echo "No encuentro Chrome sin interfaz (define CHROME=...)"; exit 1; }
PUERTO=8986

rm -rf "$KIT" && mkdir -p "$KIT"/{01-perfil,02-portadas,03-publicaciones,04-historias,05-impresos,06-stickers/whatsapp}
python3 -m http.server $PUERTO --bind 127.0.0.1 >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
sleep 1
URL="http://127.0.0.1:$PUERTO/promo/plantilla.html"

FALLOS=0
png() { # salida pieza ancho alto [transparente]
  local fondo=()
  [ "${5:-}" = transparente ] && fondo=(--default-background-color=00000000)
  "$CHROME" --no-sandbox --disable-gpu --hide-scrollbars "${fondo[@]}" --window-size="$3,$4" --virtual-time-budget=4000 \
    --screenshot="$KIT/$1" "$URL?t=$2&w=$3&h=$4" >/dev/null 2>&1
  # La plantilla pone en <title> «OK» o «DESBORDA: …» si algo se sale del lienzo.
  local estado
  estado=$("$CHROME" --no-sandbox --disable-gpu --window-size="$3,$4" --virtual-time-budget=4000 --dump-dom "$URL?t=$2&w=$3&h=$4" 2>/dev/null | grep -o '<title>[^<]*' | cut -c8-)
  if [ "$estado" = "OK" ]; then echo "  $1 ($3×$4)"; else echo "  ✗ $1: $estado"; FALLOS=$((FALLOS + 1)); fi
}
pdf() { # salida pieza ancho_css alto_css tamaño_papel
  "$CHROME" --no-sandbox --disable-gpu --virtual-time-budget=4000 --no-pdf-header-footer \
    --print-to-pdf="$RAIZ/$KIT/$1" "$URL?t=$2&w=$3&h=$4&pdf=$5" >/dev/null 2>&1
  echo "  $1 ($5, vectorial)"
}

echo "== Perfil (1080×1080; Facebook e Instagram lo recortan en círculo)"
png 01-perfil/perfil-oscuro.png perfil 1080 1080
png 01-perfil/perfil-claro.png perfil-claro 1080 1080
png 01-perfil/perfil-sello.png perfil-sello 1080 1080

echo "== Portadas"
png 02-portadas/facebook-portada-1640x624.png portada 1640 624

echo "== Publicaciones (Instagram y Facebook): vertical 4:5 y cuadrada 1:1"
n=1
for p in manifiesto privacidad modos computo qr; do
  png "03-publicaciones/0$n-$p-vertical-1080x1350.png" "post-$p" 1080 1350
  png "03-publicaciones/0$n-$p-cuadrada-1080x1080.png" "post-$p" 1080 1080
  n=$((n + 1))
done

echo "== Historias 9:16 (Instagram, Facebook y estados de WhatsApp)"
n=1
for p in manifiesto privacidad qr; do png "04-historias/0$n-historia-$p-1080x1920.png" "historia-$p" 1080 1920; n=$((n + 1)); done

echo "== Impresos (PDF vectorial para imprimir + PNG a 300 ppp para compartir)"
pdf 05-impresos/flyer-A5.pdf flyer-a5 559 794 A5
png 05-impresos/flyer-A5-300ppp.png flyer-a5 1748 2480
pdf 05-impresos/cartel-A4.pdf cartel-a4 794 1123 A4
png 05-impresos/cartel-A4-300ppp.png cartel-a4 2480 3508
pdf 05-impresos/tarjetas-4xA6-en-A4.pdf tarjetas-a4 794 1123 A4
png 05-impresos/tarjetas-4xA6-en-A4-300ppp.png tarjetas-a4 2480 3508

echo "== Stickers (PNG transparente, WebP 512 para WhatsApp y hoja A4 para papel adhesivo)"
n=1
for p in circulo sello escaneame bien-comun bocadillo apk; do
  png "06-stickers/0$n-sticker-$p.png" "sticker-$p" 1200 1200 transparente
  png "06-stickers/whatsapp/0$n-$p.png" "sticker-$p" 512 512 transparente
  n=$((n + 1))
done
# WhatsApp pide WebP de 512×512, fondo transparente y menos de 100 KB.
python3 -I -c '
import sys, pathlib
from PIL import Image
for png in sorted(pathlib.Path(sys.argv[1]).glob("*.png")):
    webp = png.with_suffix(".webp")
    for calidad in (90, 80, 70, 60, 50):
        Image.open(png).save(webp, "WEBP", quality=calidad, method=6)
        if webp.stat().st_size < 100_000: break
    else: sys.exit(f"{webp.name} pasa de 100 KB")
    png.unlink()
    print(f"  whatsapp/{webp.name} ({webp.stat().st_size // 1024} KB)")
' "$KIT/06-stickers/whatsapp"
pdf 06-stickers/hoja-stickers-A4.pdf stickers-a4 794 1123 A4
png 06-stickers/hoja-stickers-A4-300ppp.png stickers-a4 2480 3508

[ "$FALLOS" = 0 ] || { echo "✗ $FALLOS piezas se salen del lienzo"; exit 1; }
cp promo/LEEME.md promo/textos.md "$KIT/"
mkdir -p "$KIT/qr" && cp promo/qr/*.svg "$KIT/qr/"
python3 -I -c "import shutil; shutil.make_archive('promo/LibreIA-kit-difusion', 'zip', 'promo/kit')"
echo "LISTO: $KIT y promo/LibreIA-kit-difusion.zip ($(du -h promo/LibreIA-kit-difusion.zip | cut -f1))"
