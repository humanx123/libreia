// «Trae tu propia clave»: quien tiene una clave de un proveedor (gratuita o de pago) la usa para sus
// propios mensajes. Así no gasta el cupo común, que queda para quien no tiene clave.
//
// Privacidad y seguridad:
//   · La clave viaja en cada petición y solo vive en memoria mientras se atiende. No se guarda en KV,
//     ni en Durable Objects, ni en el registro del Worker. Tampoco se mezcla con las claves comunes.
//   · Solo se aceptan los proveedores de esta lista, con URLs fijas: el cliente no puede elegir a qué
//     host se manda la clave (no hay proxy abierto ni SSRF).
//   · Los fallos de una clave propia nunca «enfrían» un proveedor para los demás.

import { MODOS } from "./ia.js";

export const PROVEEDORES_PROPIOS = {
  groq: { nombre: "Groq", base: "https://api.groq.com/openai/v1" },
  google: { nombre: "Google Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai" },
  openrouter: { nombre: "OpenRouter", base: "https://openrouter.ai/api/v1", cabeceras: { "HTTP-Referer": "https://libreia.pages.dev", "X-Title": "LibreIA" } },
  cerebras: { nombre: "Cerebras", base: "https://api.cerebras.ai/v1" },
  mistral: { nombre: "Mistral", base: "https://api.mistral.ai/v1" },
  nvidia: { nombre: "NVIDIA", base: "https://integrate.api.nvidia.com/v1" },
  sambanova: { nombre: "SambaNova", base: "https://api.sambanova.ai/v1" },
  deepseek: { nombre: "DeepSeek", base: "https://api.deepseek.com/v1" },
  openai: { nombre: "OpenAI", base: "https://api.openai.com/v1" },
};

const CLAVE = /^[\x21-\x7e]{8,400}$/; // ASCII imprimible, sin espacios
const MODELO = /^[\w.:/@+-]{1,160}$/;

/** Valida el objeto `propia` que manda la app. Devuelve {proveedor, clave, modelo} o {error}. */
export function leerPropia(v) {
  if (!v || typeof v !== "object") return { error: "Clave propia: datos inválidos" };
  const proveedor = String(v.proveedor || "");
  if (!Object.hasOwn(PROVEEDORES_PROPIOS, proveedor)) return { error: "Clave propia: proveedor no admitido" };
  const clave = String(v.clave || "");
  if (!CLAVE.test(clave)) return { error: "Clave propia: la clave tiene un formato inválido" };
  const modelo = String(v.modelo || "").replace(/^models\//, "");
  if (!MODELO.test(modelo)) return { error: "Clave propia: elige un modelo válido" };
  return { proveedor, clave, modelo };
}

/**
 * Motor de un solo proveedor con la clave del usuario. Tiene la misma forma que el motor común,
 * así que la búsqueda web, las citas y los modos funcionan igual.
 */
export function motorPropio(motor, propia) {
  const def = PROVEEDORES_PROPIOS[propia.proveedor];
  const destino = { platform: "propia:" + propia.proveedor, model: propia.modelo };
  const proveedor = { url: def.base + "/chat/completions", auth: "bearer", secretName: "PROPIA", extraHeaders: def.cabeceras || {}, familia: propia.proveedor };
  return {
    ...motor,
    catalogo: {
      providers: { [destino.platform]: proveedor },
      modes: Object.fromEntries(Object.keys(MODOS).map((m) => [m, [destino]])),
      fusion: { panel: [destino], panelFallback: [], synth: destino },
    },
    claves: { PROPIA: propia.clave },
    origen: {},
    propia: { proveedor: propia.proveedor, nombre: def.nombre },
  };
}

/** Quita la clave de cualquier texto que vaya a salir (algunos proveedores la repiten en sus errores). */
export function sinClave(texto, clave) {
  let t = String(texto || "");
  if (clave) {
    t = t.split(clave).join("…");
    if (clave.length > 12) t = t.split(clave.slice(0, 12)).join("…"); // repetida a medias
  }
  return t.replace(/\b(sk|gsk|nvapi|csk|AIza)[\w-]{8,}/g, "…");
}

// Modelos que no sirven para chatear (audio, imágenes, embeddings, moderación…).
const NO_CHAT = /embed|whisper|tts|speech|audio|transcri|guard|moderation|rerank|dall-e|image|imagen|veo|ocr|realtime|search-preview|aqa|bison|gecko|playai|orpheus|safety/i;

/** Lista los modelos de chat del proveedor con la clave del usuario. */
export async function listarModelos(propia) {
  const def = PROVEEDORES_PROPIOS[propia.proveedor];
  const res = await fetch(def.base + "/models", {
    headers: { Authorization: `Bearer ${propia.clave}`, ...(def.cabeceras || {}) },
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const e = new Error(res.status === 401 || res.status === 403 ? "El proveedor rechazó la clave" : `El proveedor respondió HTTP ${res.status}`);
    e.status = res.status === 401 || res.status === 403 ? 401 : 502;
    throw e;
  }
  const texto = await res.text();
  // Las listas grandes (cientos de modelos con descripciones) no se analizan: gastarían la CPU del Worker.
  if (texto.length > 400000) {
    const e = new Error("La lista de modelos de este proveedor es demasiado grande; escribe el nombre del modelo a mano");
    e.status = 422;
    throw e;
  }
  const datos = JSON.parse(texto);
  const lista = Array.isArray(datos?.data) ? datos.data : Array.isArray(datos?.models) ? datos.models : [];
  const ids = lista
    .map((m) => String(m?.id || m?.name || "").replace(/^models\//, ""))
    .filter((id) => MODELO.test(id) && !NO_CHAT.test(id));
  return [...new Set(ids)].sort().slice(0, 300);
}
