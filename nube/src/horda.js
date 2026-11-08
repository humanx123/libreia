// Modo Comunidad (experimental): responde un modelo abierto que corre en el ordenador de un
// voluntario de AI Horde (https://aihorde.net), una red de cómputo colaborativa y gratuita.
//
//   · Se usa su puente compatible con OpenAI (oai.aihorde.net) con la clave de la Horda de LibreIA
//     (KEY_AIHORDE, da prioridad según los «kudos» de la cuenta) o, si no hay, la anónima.
//   · Qué modelos hay depende de qué voluntarios estén en línea: la lista se consulta cada 5 minutos
//     (en memoria del isolate, sin escrituras en KV) y se eligen los mejores en ese momento.
//   · Quien ejecuta el modelo PUEDE ver los mensajes: la app lo avisa antes de activar el modo.

export const HORDA_URL = "https://oai.aihorde.net/v1";
const CLAVE_ANONIMA = "0000000000";
const CACHE_MS = 5 * 60000;
const MAX_DESTINOS = 3;

// Variantes pensadas para rol o «sin filtros»: se dejan como último recurso en un asistente general.
const DE_ROL = /uncensored|heretic|abliterat|aggressive|lumimaid|stheno|magnum|rocinante|behemoth|drummer|eclipse|meromero|tutu|defiant|nsfw|lewd|erotic|\brp\b|-rp-/i;
// Familias instruct conocidas: se prefieren.
const INSTRUCT = /instruct|-it\b|-it-|gemma|qwen|llama-3|mistral|phi/i;

/** Tamaño en miles de millones de parámetros según el nombre («Qwen3-0.6B», «gemma-3-270m», «26B-A4B»…). */
function tamano(id) {
  const b = /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*b(?![a-z])/i.exec(id);
  if (b) return Number(b[1]);
  const m = /(?:^|[^\d.])(\d+)\s*m(?![a-z])/i.exec(id);
  return m ? Number(m[1]) / 1000 : null;
}
// gemma-…-E4B (4 B efectivos) cuenta como 4; los «A4B» de los MoE no se miran (el primer número es el total).
const diminuto = (id) => { const t = tamano(id); return t !== null && t < 3; };

let cache = null; // { t, modelos: [{id, workers, cola}] }

/** Modelos de chat con voluntarios en línea, ordenados de mejor a peor para un asistente general. */
export async function modelosHorda(version) {
  if (cache && Date.now() - cache.t < CACHE_MS) return cache.modelos;
  const res = await fetch(HORDA_URL + "/models", {
    headers: { Authorization: `Bearer ${CLAVE_ANONIMA}`, "Client-Agent": agente(version) },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`AI Horde respondió HTTP ${res.status} al pedir los modelos`);
  const texto = await res.text();
  if (texto.length > 300000) throw new Error("La lista de modelos de AI Horde es demasiado grande");
  const lista = JSON.parse(texto)?.data;
  const modelos = (Array.isArray(lista) ? lista : [])
    .filter((m) => typeof m?.id === "string" && m.id.length <= 160 && (m.architecture?.output_modalities || ["text"]).includes("text"))
    .map((m) => ({ id: m.id, workers: Number(m.x_horde?.workers) || 0, cola: Number(m.x_horde?.queued) || 0 }))
    .filter((m) => m.workers > 0);
  // Modelos diminutos (menos de 3 B parámetros): mezclan idiomas e inventan; van los últimos.
  const puntos = (m) => (diminuto(m.id) ? 2000000 : 0) + (DE_ROL.test(m.id) ? 1000000 : 0) + (INSTRUCT.test(m.id) ? 0 : 100000) + m.cola / Math.max(m.workers, 1);
  modelos.sort((a, b) => puntos(a) - puntos(b));
  cache = { t: Date.now(), modelos };
  return modelos;
}

/** Client-Agent que pide la Horda: nombre, versión y contacto del proyecto (nunca datos del usuario). */
const agente = (version) => `LibreIA:${version}:libreia@proton.me`;

/** Motor de un solo proveedor (la Horda) con los mejores modelos del momento. */
export async function motorComunidad(motor, version) {
  const modelos = await modelosHorda(version);
  const destinos = modelos.slice(0, MAX_DESTINOS).map((m) => ({ platform: "aihorde", model: m.id }));
  return {
    ...motor,
    catalogo: {
      providers: { aihorde: { url: HORDA_URL + "/chat/completions", auth: "bearer", secretName: "KEY_AIHORDE", extraHeaders: { "Client-Agent": agente(version) } } },
      modes: { comunidad: destinos },
      fusion: { panel: [], panelFallback: [], synth: destinos[0] },
    },
    claves: { KEY_AIHORDE: motor.claves.KEY_AIHORDE || CLAVE_ANONIMA },
    origen: {},
  };
}

/** Nombre del voluntario que respondió (solo letras, números y signos simples). */
export const voluntarioDe = (datos) => String(datos?.x_horde?.worker_name || "").replace(/[^\w .-]/g, "").trim().slice(0, 24);
