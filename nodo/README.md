# LibreIA Nodo

Presta tu ordenador a la comunidad de [LibreIA](https://libreia.pages.dev): tu modelo local responde a quien usa el modo **Comunidad**. Sin programar.

**Descarga:** [LibreIA-Nodo.exe para Windows](https://github.com/humanx123/libreia/releases/latest/download/LibreIA-Nodo.exe) · [todas las versiones (Linux, macOS, Windows ARM)](https://github.com/humanx123/libreia/releases/latest)

## Cómo se usa

1. Abre `LibreIA-Nodo.exe`. Windows puede avisar («Windows protegió tu PC») porque el programa no tiene una firma de pago: pulsa **Más información → Ejecutar de todas formas**. Compara antes la huella con `SHA256SUMS.txt` si quieres (`certutil -hashfile LibreIA-Nodo.exe SHA256`).
2. La primera vez propone instalarse en tu usuario (sin permisos de administrador): acceso directo en el escritorio y en el menú Inicio.
3. Un asistente de 4 pasos:
   - **Token:** en la app de LibreIA, Ajustes → «Presta tu ordenador» → «Generar mi token de nodo» → Copiar, y lo pegas.
   - **Proveedor local:** detecta los que están funcionando: Ollama, LM Studio, llama.cpp/LocalAI, KoboldCpp, Jan, GPT4All y vLLM. Puedes **añadir cualquier otro** servidor compatible con la API de OpenAI (en tu PC o en tu red, con clave si la pide). Si no tienes ninguno, puede **instalar Ollama** desde el propio programa.
   - **Modelo:** elige uno de los que ya tienes, descarga uno recomendado o escribe **cualquier otro** de [ollama.com/library](https://ollama.com/library).
   - **Nombre público** (opcional).
4. Prueba el modelo con una pregunta de control y se conecta. Las veces siguientes se conecta solo. Escribe `M` y Enter para el menú: cambiar modelo, proveedor o token, **iniciar con Windows** o desinstalar.

## Qué hace y qué no

- Abre una conexión de **salida** hacia LibreIA (WebSocket): no abre puertos ni expone tu servidor local.
- Responde una pregunta a la vez con el modelo que elijas. Antes de recibir preguntas responde una de control.
- **No guarda ni muestra las preguntas**: solo cuenta cuántas respondió. Ojo: quien ejecuta un nodo *podría* verlas modificando el programa; la app avisa de ello a quien usa el modo Comunidad.
- La configuración (con tu token) queda en `%APPDATA%\LibreIA\nodo.json` (Linux: `~/.config/LibreIA/`, macOS: `~/Library/Application Support/LibreIA/`). El token es como una contraseña: deja de valer si cierras sesión en todos tus dispositivos o cambias la contraseña.

## Sin asistente (servidores, scripts)

Las mismas opciones que `libreia-nodo.mjs`:

```
LibreIA-Nodo --token TU_TOKEN [--api http://127.0.0.1:11434/v1] [--modelo NOMBRE] [--nombre ALIAS] [--clave CLAVE]
LibreIA-Nodo --menu        # abrir el menú en vez de conectar
```

## Compilar

Necesita Go 1.24 o superior (las descargas oficiales se compilan con Go 1.27.4: con esa versión, `./compilar.sh` da exactamente las mismas huellas SHA-256). `./compilar.sh` deja en `dist/` los programas para Windows (x64 y ARM), Linux (x64 y ARM) y macOS (Apple y Intel), con `SHA256SUMS.txt`. El icono y los datos de versión de Windows están en `rsrc_windows_*.syso`, generados con:

```
go install github.com/tc-hib/go-winres@latest
go-winres simply --icon icono.png --manifest cli --product-name "LibreIA Nodo" --product-version 1.0.1.0 --file-version 1.0.1.0 --original-filename LibreIA-Nodo.exe --arch amd64,arm64
```

Protocolo (lado del servidor): [`nube/src/red.js`](../nube/src/red.js). Software libre, AGPL-3.0.
