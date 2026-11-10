// Enrutador de IA de LibreIA: el Worker llama directamente a proveedores gratuitos
// compatibles con OpenAI (sin servidor FreeLLMAPI, sin teléfono, sin túnel).
//
// Cada modo tiene una lista ordenada de {platform, model}. Se prueba en orden y,
// si un proveedor falla (429, 5xx, timeout), se pasa al siguiente. Los fallos se
// recuerdan unos minutos en memoria del isolate (sin escrituras en KV) para no
// insistir con un proveedor caído. Si todos fallan, el error devuelto lista cada
// intento con su causa real.


export const MODOS = {
  neutral: {
    nombre: "Neutral",
    sistema:
      "Eres LibreIA, un asistente útil e imparcial. Responde en el idioma del usuario. " +
      "Presenta los temas discutidos con equilibrio, mostrando los distintos puntos de vista con sus mejores argumentos, " +
      "y distingue con claridad hechos, opiniones e incertidumbre.",
  },
  libre: {
    nombre: "Libre",
    sistema:
      "Eres LibreIA en modo libre. Responde en el idioma del usuario de forma directa, franca y completa. " +
      "Trata al usuario como un adulto capaz: sin sermones, sin moralina y sin avisos innecesarios. " +
      "Si un tema es polémico, da tu análisis honesto en vez de evadirlo.",
  },
  tecnico: {
    nombre: "Técnico",
    sistema:
      "Eres LibreIA en modo técnico: un ingeniero de software experto. Responde en el idioma del usuario. " +
      "Da soluciones correctas y concretas, con código completo en bloques ``` con el lenguaje indicado, " +
      "y explica brevemente las decisiones importantes.",
  },
  comunidad: {
    nombre: "Comunidad",
    sistema:
      "Eres LibreIA, un asistente útil e imparcial. Responde siempre en el idioma del usuario, de forma clara y directa. " +
      "Si no sabes algo, dilo. No inventes datos ni fuentes.",
  },
  fusion: {
    nombre: "Fusión",
    sistema:
      "Eres LibreIA. Responde en el idioma del usuario de forma útil, precisa y completa.",
  },
};

const MAX_TOKENS = 2000;
const MAX_MENSAJES = 40;
const MAX_CARACTERES = 60000;
const TIEMPO_INTENTO_MS = 25000;
// Presupuesto total por respuesta: la app espera 90 s; se deja margen.
const PRESUPUESTO_MS = 75000;
const ENFRIAMIENTO_MS = { 429: 120000, auth: 30 * 60000, otro: 60000 };

// Enfriamiento por proveedor+modelo, solo en memoria del isolate.
const enfriados = new Map();

// Solo se enfría por fallos del proveedor (clave, cuota, caída, tiempo). Los 4xx causados
// por la propia petición (400, 413, 422) no castigan al proveedor para los demás usuarios.
const esFalloDelProveedor = (estado) => [401, 402, 403, 404, 408, 429, 504].includes(estado) || estado >= 500;

function enfriar(clave, motivo) {
  if (!esFalloDelProveedor(motivo)) return;
  const ms = motivo === 429 ? ENFRIAMIENTO_MS[429] : motivo === 401 || motivo === 403 ? ENFRIAMIENTO_MS.auth : ENFRIAMIENTO_MS.otro;
  enfriados.set(clave, Date.now() + ms);
}

function estaEnfriado(clave) {
  const hasta = enfriados.get(clave);
  if (!hasta) return false;
  if (Date.now() > hasta) {
    enfriados.delete(clave);
    return false;
  }
  return true;
}

export class ErrorIA extends Error {
  constructor(mensaje, estado, intentos) {
    super(mensaje);
    this.estado = estado;
    this.intentos = intentos;
  }
}

/** Limpia y acota la conversación que manda el cliente. */
export function prepararMensajes(mensajes, modo, sistemaPersonalizado, { maxCaracteres = MAX_CARACTERES } = {}) {
  if (!Array.isArray(mensajes) || !mensajes.length) throw new ErrorIA("Faltan los mensajes", 400, []);
  const MAX_CARACTERES_PEDIDO = Math.min(maxCaracteres, MAX_CARACTERES);
  const limpios = mensajes
    .filter((m) => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }))
    .slice(-MAX_MENSAJES);
  // Recorta desde el principio hasta caber en el presupuesto de caracteres.
  let total = limpios.reduce((n, m) => n + m.content.length, 0);
  while (limpios.length > 1 && total > MAX_CARACTERES_PEDIDO) total -= limpios.shift().content.length;
  if (!limpios.length || limpios[limpios.length - 1].role !== "user") throw new ErrorIA("El último mensaje debe ser del usuario", 400, []);
  if (total > MAX_CARACTERES_PEDIDO) limpios[0].content = limpios[0].content.slice(-MAX_CARACTERES_PEDIDO);
  const sistema = (typeof sistemaPersonalizado === "string" && sistemaPersonalizado.trim()) || MODOS[modo].sistema;
  // La fecha real evita respuestas del tipo «mis datos llegan hasta 2024».
  const fecha = new Date().toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const formato = "Usa Markdown cuando ayude a leer (títulos, listas, **negritas**, tablas, bloques de código).";
  return [{ role: "system", content: `${sistema}\n\nFecha de hoy: ${fecha}. ${formato}` }, ...limpios];
}

const propio = (obj, clave) => !!obj && Object.hasOwn(obj, clave);

// Aviso para los modelos cuyas referencias los usuarios marcaron como inexistentes (ver /v1/referencias/verificar).
export const AVISO_REFERENCIAS =
  "\n\nIMPORTANTE: personas usuarias han comprobado que a veces citas referencias o enlaces que no existen. " +
  "Cita solo las fuentes consultadas que se te dan (con su número entre corchetes) o enlaces que conozcas con total certeza. " +
  "Si no tienes una fuente real, dilo en vez de inventarla. Nunca inventes URLs, títulos, autores ni años.";
/** Mensajes con el aviso añadido al sistema si el destino está entre los avisados. */
export function conAviso(mensajes, destino, avisados) {
  if (!avisados?.has?.(`${destino.platform}/${destino.model}`) || mensajes[0]?.role !== "system") return mensajes;
  return [{ role: "system", content: mensajes[0].content + AVISO_REFERENCIAS }, ...mensajes.slice(1)];
}

function proveedor(motor, platform) {
  const p = propio(motor.catalogo.providers, platform) ? motor.catalogo.providers[platform] : null;
  if (!p) throw new Error(`Proveedor desconocido: ${platform}`);
  return p;
}

/** Proveedores configurados (con su secreto puesto, o sin clave). */
export function disponible(motor, platform) {
  const p = propio(motor.catalogo.providers, platform) ? motor.catalogo.providers[platform] : null;
  return !!p && (!p.secretName || !!motor.claves[p.secretName]);
}

function cabeceras(motor, p) {
  const h = { "Content-Type": "application/json", ...(p.extraHeaders || {}) };
  const clave = p.secretName ? motor.claves[p.secretName] : null;
  if (clave) {
    if (p.auth === "x-api-key") h["x-api-key"] = clave;
    else if (p.auth === "x-goog-api-key") h["x-goog-api-key"] = clave;
    else h.Authorization = `Bearer ${clave}`;
  }
  return h;
}

/**
 * Una llamada a un proveedor. Devuelve la Response si es 2xx o lanza con el detalle.
 * El temporizador cubre solo hasta que llegan las cabeceras, para no cortar un stream largo;
 * sin stream, el llamador lee el cuerpo con leerJson(), que tiene su propio límite.
 */
async function llamar(motor, destino, cuerpo, tiempoMs = TIEMPO_INTENTO_MS) {
  const p = proveedor(motor, destino.platform);
  const extra = {};
  // familia: con una clave propia el destino se llama "propia:groq", pero es Groq igualmente.
  if ((p.familia || destino.platform) === "groq") {
    // gpt-oss razona antes de responder y ese razonamiento gasta max_tokens.
    if (destino.model.includes("gpt-oss")) extra.reasoning_effort = "low";
    // qwen en Groq: que no devuelva el bloque <think> dentro del contenido.
    else if (destino.model.includes("qwen")) extra.reasoning_format = "hidden";
  }
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(new DOMException("tiempo agotado", "TimeoutError")), Math.max(1000, tiempoMs));
  let res;
  try {
    res = await fetch(p.url, {
      method: "POST",
      headers: cabeceras(motor, p),
      body: JSON.stringify({ ...cuerpo, ...extra, model: destino.model }),
      signal: control.signal,
      // Nunca seguir redirecciones: la clave del proveedor iría a otro host. Workers solo admite
      // "follow" o "manual"; con "manual" un 3xx llega como !res.ok y se trata como fallo.
      redirect: "manual",
    });
  } finally {
    if (cuerpo.stream) clearTimeout(temporizador);
  }
  if (!res.ok) {
    clearTimeout(temporizador);
    const texto = await res.text().catch(() => "");
    let detalle = texto.slice(0, 200);
    try {
      const j = JSON.parse(texto);
      const m = j.error?.message ?? j.error ?? j.message ?? j.detail ?? detalle;
      detalle = (typeof m === "string" ? m : JSON.stringify(m)).slice(0, 200);
    } catch {
      /* texto plano */
    }
    const e = new Error(`HTTP ${res.status}: ${detalle}`);
    e.status = res.status;
    throw e;
  }
  res.temporizador = temporizador;
  return res;
}

/** Lee el JSON de una respuesta sin stream y libera su temporizador. */
async function leerJson(res) {
  try {
    return await res.json();
  } finally {
    clearTimeout(res.temporizador);
  }
}

function textoDe(datos) {
  const c = datos?.choices?.[0]?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((x) => x?.text || "").join("");
  return "";
}

// Algunos modelos de razonamiento devuelven el pensamiento entre <think>…</think>.
// Un <think> sin cerrar significa que el razonamiento agotó los tokens: no hay respuesta.
const quitarPensamiento = (t) => t.replace(/<think>[\s\S]*?(<\/think>|$)\s*/g, "").trim();

const claveDe = (d) => `${d.platform}/${d.model}`;
const ordenarPorFrescura = (lista) => [...lista.filter((d) => !estaEnfriado(claveDe(d))), ...lista.filter((d) => estaEnfriado(claveDe(d)))];
const describirError = (e) => (e?.name === "TimeoutError" ? "tiempo agotado" : e?.message || String(e));

/** Pide una respuesta completa (sin stream) a un destino y la devuelve limpia. */
async function pedirTexto(motor, destino, cuerpo, tiempoMs) {
  const res = await llamar(motor, destino, { ...cuerpo, stream: false }, tiempoMs);
  const datos = await leerJson(res);
  const texto = quitarPensamiento(textoDe(datos));
  if (!texto) throw Object.assign(new Error("respuesta vacía (el modelo agotó los tokens razonando)"), { status: 502 });
  return { texto, datos };
}

/** Valida max_tokens y temperature del cliente para no mandar valores que el proveedor rechace. */
function parametros(maxTokens, temperatura) {
  const n = Number.isFinite(maxTokens) ? Math.floor(maxTokens) : MAX_TOKENS;
  const cuerpo = { max_tokens: Math.min(Math.max(n, 64), MAX_TOKENS) };
  if (typeof temperatura === "number" && Number.isFinite(temperatura)) cuerpo.temperature = Math.min(Math.max(temperatura, 0), 2);
  return cuerpo;
}

/**
 * Recorre la lista de un modo hasta que un proveedor responde.
 * Con stream=true devuelve la Response SSE del proveedor tal cual.
 */
export async function completar(motor, modo, mensajes, { stream = false, maxTokens, temperatura, presupuestoMs = PRESUPUESTO_MS, sinEnfriar = false, tiempoIntentoMs = TIEMPO_INTENTO_MS, avisados = null } = {}) {
  const lista = propio(motor.catalogo.modes, modo) ? motor.catalogo.modes[modo] : null;
  if (!lista) throw new ErrorIA(`Modo desconocido: ${modo}`, 400, []);
  const cuerpo = { messages: mensajes, ...parametros(maxTokens, temperatura), stream };

  const intentos = [];
  const candidatos = lista.filter((d) => disponible(motor, d.platform));
  if (!candidatos.length) throw new ErrorIA(`No hay proveedores configurados para el modo ${modo}`, 503, intentos);

  const limite = Date.now() + presupuestoMs;
  let fallosDelPedido = 0; // 400/413/422 seguidos: el problema es la petición, no el proveedor
  for (const destino of ordenarPorFrescura(candidatos)) {
    const inicio = Date.now();
    const restante = limite - inicio;
    if (restante < 3000) {
      intentos.push({ proveedor: destino.platform, modelo: destino.model, error: "sin tiempo: se agotó el presupuesto de la respuesta" });
      break;
    }
    const tiempo = Math.min(tiempoIntentoMs, restante);
    const cuerpoDestino = { ...cuerpo, messages: conAviso(cuerpo.messages, destino, avisados) };
    try {
      if (stream) {
        const res = await llamar(motor, destino, cuerpoDestino, tiempo);
        return { stream: res, destino };
      }
      const { texto, datos } = await pedirTexto(motor, destino, cuerpoDestino, tiempo);
      return { texto, destino, ms: Date.now() - inicio, uso: datos.usage || null, fin: datos.choices?.[0]?.finish_reason || "stop", horda: datos.x_horde || null };
    } catch (e) {
      intentos.push({ proveedor: destino.platform, modelo: destino.model, error: describirError(e), ms: Date.now() - inicio });
      // Una tarea auxiliar (p. ej. reescribir la consulta con poco tiempo) no castiga al proveedor.
      if (!sinEnfriar) enfriar(claveDe(destino), e.status || (e.name === "TimeoutError" ? 504 : 502));
      if ([400, 413, 422].includes(e.status)) {
        if (++fallosDelPedido >= 2) break; // no gastar la cuota de todos los proveedores en una petición inválida
      } else fallosDelPedido = 0;
    }
  }
  throw new ErrorIA(`Todos los proveedores del modo ${MODOS[modo]?.nombre || modo} fallaron`, 503, intentos);
}

/**
 * Fusión: varios modelos responden en paralelo y un sintetizador combina lo mejor.
 * Si el sintetizador falla, se devuelve la respuesta más completa del panel.
 * Todo cabe en el mismo presupuesto de tiempo que un modo normal.
 */
export async function fusionar(motor, mensajes, { presupuestoMs = PRESUPUESTO_MS, avisados = null } = {}) {
  const { panel, panelFallback = [], synth } = motor.catalogo.fusion;
  const limite = Date.now() + Math.min(presupuestoMs, PRESUPUESTO_MS);
  const restante = () => limite - Date.now();

  // Tres modelos de proveedores configurados; los enfriados ceden su sitio a los de respaldo.
  const elegidos = ordenarPorFrescura([...panel, ...panelFallback].filter((d) => disponible(motor, d.platform))).slice(0, 3);
  const resultados = await Promise.allSettled(
    elegidos.map(async (destino) => {
      try {
        const { texto } = await pedirTexto(motor, destino, { messages: conAviso(mensajes, destino, avisados), max_tokens: 1500 }, TIEMPO_INTENTO_MS);
        return { destino, texto };
      } catch (e) {
        enfriar(claveDe(destino), e.status || (e.name === "TimeoutError" ? 504 : 502));
        throw e;
      }
    }),
  );
  const buenas = resultados.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const intentos = resultados
    .map((r, i) => (r.status === "rejected" ? { proveedor: elegidos[i].platform, modelo: elegidos[i].model, error: describirError(r.reason) } : null))
    .filter(Boolean);

  // Si el panel no da ninguna respuesta, se usa el modo neutral con el tiempo que queda.
  if (!buenas.length) {
    try {
      const r = await completar(motor, "neutral", mensajes, { presupuestoMs: Math.max(restante(), 0), avisados });
      return { ...r, fusion: { panel: [], fallos: intentos, respaldo: true } };
    } catch (e) {
      if (e instanceof ErrorIA) throw new ErrorIA("Fusión: fallaron el panel y el modo neutral de respaldo", 503, [...intentos, ...e.intentos]);
      throw e;
    }
  }
  if (buenas.length === 1) return { texto: buenas[0].texto, destino: buenas[0].destino, fusion: { panel: [buenas[0].destino], fallos: intentos } };

  const pregunta = mensajes[mensajes.length - 1].content;
  const borradores = buenas.map((b, i) => `### Respuesta ${i + 1}\n${b.texto}`).join("\n\n");
  const sintesis = [
    {
      role: "system",
      content:
        "Eres un editor experto. Recibes varias respuestas de distintos modelos a la misma pregunta. " +
        "Escribe UNA sola respuesta final, en el idioma de la pregunta, que combine lo mejor de cada una: " +
        "corrige errores, elimina repeticiones y conserva los datos y el código correctos. " +
        "Conserva las citas entre corchetes como [1] o [2] cuando acompañen a un dato. " +
        "No menciones que hubo varias respuestas ni a los modelos.",
    },
    ...mensajes.slice(1, -1),
    { role: "user", content: `Pregunta:\n${pregunta}\n\n${borradores}\n\nEscribe ahora la respuesta final.` },
  ];
  // Sintetizador y, si falla, modelos del modo neutral; los enfriados al final.
  const vistos = new Set();
  const sintetizadores = ordenarPorFrescura([synth, ...motor.catalogo.modes.neutral].filter((d) => disponible(motor, d.platform)))
    .filter((d) => !vistos.has(claveDe(d)) && vistos.add(claveDe(d)))
    .slice(0, 3);
  for (const destino of sintetizadores) {
    if (restante() < 3000) {
      intentos.push({ proveedor: destino.platform, modelo: destino.model, error: "síntesis: sin tiempo" });
      break;
    }
    try {
      const { texto, datos } = await pedirTexto(motor, destino, { messages: conAviso(sintesis, destino, avisados), max_tokens: MAX_TOKENS }, Math.min(TIEMPO_INTENTO_MS, restante()));
      return { texto, destino, fin: datos.choices?.[0]?.finish_reason || "stop", fusion: { panel: buenas.map((b) => b.destino), sintetizador: destino, fallos: intentos } };
    } catch (e) {
      intentos.push({ proveedor: destino.platform, modelo: destino.model, error: `síntesis: ${describirError(e)}` });
      enfriar(claveDe(destino), e.status || (e.name === "TimeoutError" ? 504 : 502));
    }
  }
  const mejor = buenas.reduce((a, b) => (b.texto.length > a.texto.length ? b : a));
  return { texto: mejor.texto, destino: mejor.destino, fusion: { panel: buenas.map((b) => b.destino), fallos: intentos, sinSintesis: true } };
}

/** Prueba un {platform, model} concreto (lo usa el panel de administración). */
export async function probarDestino(motor, destino) {
  const inicio = Date.now();
  if (!propio(motor.catalogo.providers, destino.platform)) return { ok: false, error: "proveedor desconocido", ms: 0 };
  if (!disponible(motor, destino.platform)) return { ok: false, error: "falta la clave del proveedor", ms: 0 };
  try {
    const { texto } = await pedirTexto(motor, destino, { messages: [{ role: "user", content: "Responde solo: OK" }], max_tokens: 256 }, 30000);
    return { ok: true, ms: Date.now() - inicio, texto: texto.slice(0, 120) };
  } catch (e) {
    return { ok: false, ms: Date.now() - inicio, error: describirError(e) };
  }
}
