# Kit de difusión de LibreIA

Imágenes listas para compartir LibreIA en redes y en papel. Todo es libre: úsalo, imprímelo y repártelo.

| Carpeta | Qué hay | Dónde usarlo |
|---|---|---|
| `01-perfil` | Logo LIBREIA en 1080×1080 (oscuro, claro y sello cian) | Foto de perfil de Facebook, Instagram, WhatsApp o Telegram. Se recorta en círculo y el logo cabe entero. |
| `02-portadas` | Portada de 1640×624 | Portada de página o perfil de Facebook. En el móvil se recortan los lados; el mensaje va al centro. |
| `03-publicaciones` | 5 publicaciones, cada una en vertical 4:5 (1080×1350) y cuadrada (1080×1080) | Feed de Instagram y Facebook. Juntas forman un carrusel: manifiesto → privacidad → modos → cómputo → QR. |
| `04-historias` | 3 historias de 1080×1920 | Historias de Instagram y Facebook, y estados de WhatsApp. Arriba y abajo hay margen para los botones de la app. |
| `05-impresos` | Flyer A5, cartel A4 y 4 tarjetas A6 en una hoja A4. En PDF (para imprimir) y en PNG a 300 ppp | Universidades, bibliotecas, cafés, centros sociales… |
| `06-stickers` | 6 stickers con QR y fondo transparente (1200×1200), los mismos en WebP 512×512 para WhatsApp (`whatsapp/`) y una hoja A4 con los seis para imprimir | Para pegarlos en el portátil, el móvil o la botella, en historias o como stickers de WhatsApp. |
| `qr` | Los QR en SVG (vectoriales) | Para tus propios diseños |

## Los QR

- `qr-sitio` → <https://libreia.pages.dev>: el sitio con el manifiesto, la descarga y la prueba.
- `qr-probar` → <https://libre-ia.pages.dev/?probar=1>: abre el chat en modo prueba, sin registro.
- `qr-apk` → descarga directa de la app para Android.

## Imprimir

- Imprime los PDF **al 100 %** (sin «ajustar a la página») y **con gráficos de fondo** activados.
- Las tarjetas A6 se cortan por las líneas discontinuas: salen 4 por hoja.
- Si imprimes en blanco y negro, los QR siguen funcionando: son negro sobre blanco.

## Stickers

- **Digitales:** los PNG de `06-stickers` tienen fondo transparente: ponlos encima de una historia o una foto.
- **WhatsApp:** WhatsApp no importa archivos sueltos. Usa una app para crear stickers personales (por ejemplo, «Sticker Maker») y añade los seis WebP de `whatsapp/`: ya cumplen su formato (512×512, transparentes y de menos de 100 KB).
- **En papel:** imprime `hoja-stickers-A4.pdf` al 100 % en papel adhesivo y recorta por la línea discontinua. Cada sticker mide unos 9 cm y su QR se lee a un palmo de distancia.

## Textos

En `textos.md` hay textos para acompañar cada publicación, con hashtags.

---

Diseño «Pancarta»: Anton, Space Mono y Archivo (fuentes libres OFL), con los colores tinta, papel, cian y rojo de LibreIA.
Se regenera con `./promo/generar.sh` a partir de `promo/plantilla.html`.

*Hecho xhumanx + IA*
