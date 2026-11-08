#!/usr/bin/env node
// Nodo LibreIA: presta tu ordenador para que tu modelo local responda a la comunidad de LibreIA.
//
//   node libreia-nodo.mjs --token TU_TOKEN [--api http://127.0.0.1:11434/v1] [--modelo NOMBRE] [--nombre ALIAS]
//
// Necesitas Node.js 22 o superior y un servidor local compatible con OpenAI:
//   · Ollama     → --api http://127.0.0.1:11434/v1   (por defecto)
//   · LM Studio  → --api http://127.0.0.1:1234/v1
//   · llama.cpp  → --api http://127.0.0.1:8080/v1
//   · KoboldCpp  → --api http://127.0.0.1:5001/v1
// El token se genera en la app de LibreIA: Configuración → «Presta tu ordenador».
//
// Qué hace y qué no:
//   · Abre una conexión de SALIDA hacia LibreIA (no abre puertos en tu red ni expone tu servidor local).
//   · Responde una pregunta a la vez, con el modelo que elijas.
//   · NO guarda ni muestra las preguntas: solo cuenta cuántas respondió. Puedes leer este archivo entero.
//   · Ctrl+C lo detiene cuando quieras.
//
// Software libre (AGPL-3.0) · https://github.com/humanx123/libreia

const VERSION = "1.0.0";
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "1"]] : acc), []),
);
const TOKEN = args.token || process.env.LIBREIA_NODO_TOKEN || "";
const API = (args.api || process.env.LIBREIA_NODO_API || "http://127.0.0.1:11434/v1").replace(/\/+$/, "");
const SERVIDOR = args.servidor || "wss://libreia-api.libreia-chat-mobile.workers.dev/v1/red/conectar";
const NOMBRE = (args.nombre || "").slice(0, 24);
const CLAVE_LOCAL = args.clave || process.env.LIBREIA_NODO_CLAVE || ""; // solo si tu servidor local pide clave
const TIEMPO_RESPUESTA_MS = 60000;

if (args.help || args.h || !TOKEN) {
  console.log(`Nodo LibreIA ${VERSION}

Uso: node libreia-nodo.mjs --token TU_TOKEN [--api URL] [--modelo NOMBRE] [--nombre ALIAS]

  --token    Token de nodo (app de LibreIA → Configuración → «Presta tu ordenador»)
  --api      Servidor local compatible con OpenAI (por defecto ${"http://127.0.0.1:11434/v1"}, Ollama)
  --modelo   Modelo a usar (por defecto, el primero que ofrezca tu servidor)
  --nombre   Alias público del nodo (aparece como «respondió nodo LibreIA <alias>»)
  --clave    Clave de tu servidor local, si la pide`);
  process.exit(TOKEN ? 0 : 1);
}
if (typeof WebSocket !== "function") {
  console.error("✗ Necesitas Node.js 22 o superior (tienes " + process.version + ").");
  process.exit(1);
}

const cabecerasLocales = { "Content-Type": "application/json", ...(CLAVE_LOCAL ? { Authorization: `Bearer ${CLAVE_LOCAL}` } : {}) };
const hora = () => new Date().toLocaleTimeString();

async function elegirModelo() {
  if (args.modelo) return args.modelo;
  const res = await fetch(API + "/models", { headers: cabecerasLocales, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`tu servidor local respondió HTTP ${res.status} en ${API}/models`);
  const ids = ((await res.json()).data || []).map((m) => m.id).filter((id) => !/embed/i.test(id));
  if (!ids.length) throw new Error("tu servidor local no tiene ningún modelo cargado");
  return ids[0];
}

async function responder(pedido, modelo) {
  const res = await fetch(API + "/chat/completions", {
    method: "POST",
    headers: cabecerasLocales,
    body: JSON.stringify({ model: modelo, messages: pedido.mensajes, max_tokens: pedido.max_tokens || 800, temperature: pedido.temperature ?? 0.7, stream: false }),
    signal: AbortSignal.timeout(TIEMPO_RESPUESTA_MS),
  });
  if (!res.ok) throw new Error(`servidor local HTTP ${res.status}`);
  const d = await res.json();
  const c = d?.choices?.[0]?.message?.content;
  const texto = typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => x?.text || "").join("") : "";
  if (!texto.trim()) throw new Error("el modelo devolvió una respuesta vacía");
  return texto;
}

let respondidas = 0;
let espera = 2000;

async function conectar() {
  let modelo;
  try {
    modelo = await elegirModelo();
  } catch (e) {
    console.error(`[${hora()}] ✗ No se pudo usar tu servidor local: ${e.message}. Reintento en 30 s…`);
    return setTimeout(conectar, 30000);
  }
  const ws = new WebSocket(SERVIDOR);
  let latido;
  ws.addEventListener("open", () => {
    espera = 2000;
    console.log(`[${hora()}] Conectado a LibreIA. Modelo: ${modelo}. Respondiendo la pregunta de control…`);
    ws.send(JSON.stringify({ tipo: "hola", token: TOKEN, modelos: [modelo], nombre: NOMBRE, version: VERSION }));
    latido = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 25000);
  });
  ws.addEventListener("message", async (ev) => {
    if (ev.data === "pong") return;
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (m.tipo === "activo") return console.log(`[${hora()}] ✓ ${m.mensaje}`);
    if (m.tipo !== "pedido") return;
    const inicio = Date.now();
    try {
      const texto = await responder(m, modelo);
      ws.send(JSON.stringify({ tipo: "respuesta", id: m.id, texto, modelo }));
      if (!m.control) console.log(`[${hora()}] → respuesta enviada en ${((Date.now() - inicio) / 1000).toFixed(1)} s (total: ${++respondidas})`);
    } catch (e) {
      ws.send(JSON.stringify({ tipo: "error", id: m.id, error: String(e.message || e).slice(0, 120) }));
      console.error(`[${hora()}] ✗ No se pudo responder: ${e.message}`);
    }
  });
  ws.addEventListener("close", (ev) => {
    clearInterval(latido);
    // 4001-4004: token inválido, bloqueo, límite de nodos o control fallido: reintentar no sirve.
    if (ev.code >= 4001 && ev.code <= 4004) {
      console.error(`[${hora()}] ✗ LibreIA cerró la conexión: ${ev.reason || ev.code}`);
      process.exit(2);
    }
    console.log(`[${hora()}] Conexión cerrada (${ev.code}${ev.reason ? ": " + ev.reason : ""}). Reconectando en ${espera / 1000} s…`);
    setTimeout(conectar, espera);
    espera = Math.min(espera * 2, 120000);
  });
  ws.addEventListener("error", () => {
    /* el evento close llega después y reconecta */
  });
}

console.log(`Nodo LibreIA ${VERSION} · servidor local: ${API}`);
console.log("Tus preguntas respondidas no se guardan ni se muestran aquí. Ctrl+C para detener.\n");
conectar();
