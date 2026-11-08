// libreia-api — Worker con APIs de usuario y conversaciones
// Usa CONFIG KV existente para almacenar usuarios y chats.
// La IA se sirve desde ia.js llamando directamente a proveedores gratuitos.

import { MODOS, ErrorIA, prepararMensajes, completar, fusionar, disponible, probarDestino } from "./ia.js";
import { cargarMotor, invalidarMotor } from "./motor.js";
import { igualesSeguro } from "./cifrado.js";
import { registrarEstadistica, EVENTOS_APP } from "./estadisticas.js";
import { buscarWeb, vale_la_pena_buscar, contextoFuentes } from "./busqueda.js";

export { Estadisticas } from "./estadisticas.js";
export { Comunidad } from "./comunidad.js";

const VERSION = "3.1.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Origin, X-Requested-With, X-LibreIA-Instalacion, X-LibreIA-Plataforma, X-LibreIA-Version",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Health check
    if (path === "/health") {
      return json(estadoProveedores(await cargarMotor(env)), 200, CORS_HEADERS);
    }

    // Endpoints internos: solo para el panel de administración (Service Binding + INTERNAL_TOKEN).
    if (path.startsWith("/interno/")) {
      return manejarInterno(request, env, path);
    }

    // Public config (no auth required)
    if (path === "/api/config" && method === "GET") {
      return getPublicConfig(env, CORS_HEADERS);
    }

    // Las antiguas rutas públicas de usuarios y chats (/api/auth, /api/users, /api/chats) se
    // quitaron: la app no las usa y permitían agotar la cuota diaria de escrituras de KV.

    // API compatible con OpenAI (v1/*)
    if (path.startsWith("/v1/")) {
      return manejarV1(request, env, path, ctx);
    }

    // Static assets
    if (path === "/" || path.startsWith("/assets/")) {
      try {
        const resp = await env.ASSETS.fetch(request);
        return new Response(resp.body, { status: resp.status, headers: resp.headers });
      } catch (e) {
        return json({ error: "Asset not found" }, 404);
      }
    }

    return json({ error: "Not found" }, 404);
  },
};

// ===== Estado (sin claves) =====
function estadoProveedores(motor) {
  const cat = motor.catalogo;
  const proveedores = Object.keys(cat.providers).map((id) => ({ id, configurado: disponible(motor, id) }));
  const modos = Object.fromEntries(
    Object.keys(MODOS).map((m) => [m, (m === "fusion" ? [...cat.fusion.panel, ...(cat.fusion.panelFallback || [])] : cat.modes[m] || []).filter((d) => disponible(motor, d.platform)).length]),
  );
  return { ok: !motor.avisos.length, service: "libreia-api", version: VERSION, mantenimiento: !!motor.ajustes.mantenimiento, proveedores, modos, avisos: motor.avisos };
}

// ===== Endpoints internos (panel de administración) =====
async function manejarInterno(request, env, path) {
  const token = request.headers.get("X-Interno") || "";
  if (!env.INTERNAL_TOKEN || !igualesSeguro(token, env.INTERNAL_TOKEN)) return json({ error: "No autorizado" }, 401);

  if (path === "/interno/recargar" && request.method === "POST") {
    invalidarMotor();
    return json({ ok: true });
  }
  const motor = await cargarMotor(env);

  if (path === "/interno/estado" && request.method === "GET") {
    const cat = motor.catalogo;
    const claves = Object.values(cat.providers)
      .filter((p) => p.secretName)
      .map((p) => p.secretName)
      .filter((v, i, a) => a.indexOf(v) === i)
      .map((nombre) => ({
        nombre,
        proveedores: Object.entries(cat.providers).filter(([, p]) => p.secretName === nombre).map(([id]) => id),
        origen: motor.origen[nombre] || "ninguna",
        // Solo los 4 últimos caracteres, y solo si la clave es larga (nunca la clave entera).
        final: motor.claves[nombre]?.length >= 16 ? "…" + motor.claves[nombre].slice(-4) : motor.claves[nombre] ? "…" : null,
      }));
    return json({
      ...estadoProveedores(motor),
      catalogoPersonalizado: motor.personalizado,
      claves,
      ajustes: motor.ajustes,
      sistemaPorDefecto: Object.fromEntries(Object.entries(MODOS).map(([id, m]) => [id, m.sistema])),
    });
  }

  if (path === "/interno/probar" && request.method === "POST") {
    const { platform, model, modo } = await request.json().catch(() => ({}));
    if (modo) {
      const inicio = Date.now();
      try {
        const mensajes = prepararMensajes([{ role: "user", content: "Responde en una frase: ¿qué es LibreIA?" }], modo, motor.ajustes.sistema?.[modo]);
        const r = modo === "fusion" ? await fusionar(motor, mensajes) : await completar(motor, modo, mensajes);
        return json({ ok: true, ms: Date.now() - inicio, texto: r.texto.slice(0, 200), proveedor: r.destino?.platform, modelo: r.destino?.model });
      } catch (e) {
        return json({ ok: false, ms: Date.now() - inicio, error: e.message, intentos: e.intentos || [] });
      }
    }
    if (!platform || !model) return json({ error: "Faltan platform y model" }, 400);
    return json(await probarDestino(motor, { platform, model }));
  }

  return json({ error: "Ruta interna no encontrada" }, 404);
}

// ===== Public config =====
const WORKER_V1_URL = "https://libreia-api.libreia-chat-mobile.workers.dev/v1";

async function getPublicConfig(env, corsHeaders) {
  // La app usa siempre el /v1 del propio Worker. El token es público (va dentro del APK):
  // solo filtra tráfico casual; el límite real lo pone el limitador por IP.
  return json({
    freellmapi: {
      url: WORKER_V1_URL,
      apiKey: env.APP_TOKEN,
      models: Object.keys(MODOS),
    },
    modos: Object.entries(MODOS).map(([id, m]) => ({ id, nombre: m.nombre })),
    version: VERSION,
    appName: "LibreIA",
    service: "libreia-api"
  }, 200, corsHeaders);
}

// ===== /v1: API compatible con OpenAI =====
async function manejarV1(request, env, path, ctx) {
  const motor = await cargarMotor(env);
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");

  // Transparencia: números públicos agregados, sin token.
  if (path === "/v1/transparencia" && request.method === "GET") {
    return json(await transparencia(env, motor), 200, { ...CORS_HEADERS, "Cache-Control": "public, max-age=300" });
  }

  // Quién llama: una cuenta (token de sesión "s1.") o la app sin sesión (token público de la app).
  const cuenta = token.startsWith("s1.") ? await verificarSesion(env, token) : null;
  // APP_TOKEN_ANTERIOR (secreto, opcional): mantiene funcionando las APK publicadas antes de rotar el token.
  const esApp = (!!env.APP_TOKEN && igualesSeguro(token, env.APP_TOKEN)) || (!!env.APP_TOKEN_ANTERIOR && igualesSeguro(token, env.APP_TOKEN_ANTERIOR));
  if (!cuenta && !esApp) {
    return errorOpenAI(token.startsWith("s1.") ? "Tu sesión caducó: vuelve a entrar con tu correo y contraseña" : "Token inválido", 401, "invalid_api_key");
  }

  // Cuentas y comunidad.
  if (path.startsWith("/v1/cuenta/") || path.startsWith("/v1/propuestas")) {
    return manejarComunidad(request, env, path, cuenta);
  }

  if (path === "/v1/models" && request.method === "GET") {
    return json({
      object: "list",
      data: Object.entries(MODOS).map(([id, m]) => ({ id, object: "model", owned_by: "libreia", name: m.nombre })),
    }, 200, CORS_HEADERS);
  }

  // Eventos anónimos de la app (abrir la app, abrir donar, copiar una dirección...).
  if (path === "/v1/eventos" && request.method === "POST") {
    const ip = request.headers.get("CF-Connecting-IP") || "anon";
    if ((await limitePorIp(env, "ev:" + ip, 30)) > 0) return json({ ok: false, error: "demasiados eventos" }, 429, CORS_HEADERS);
    const { tipo } = await request.json().catch(() => ({}));
    if (typeof tipo !== "string" || !EVENTOS_APP.has(tipo)) return json({ ok: false, error: "evento desconocido" }, 400, CORS_HEADERS);
    ctx.waitUntil(registrarEstadistica(env, request, [`evento:${tipo}`]));
    return json({ ok: true }, 200, CORS_HEADERS);
  }

  if (path === "/v1/chat/completions" && request.method === "POST") {
    if (motor.ajustes.mantenimiento) {
      return errorOpenAI(motor.ajustes.mensajeMantenimiento, 503, "maintenance");
    }
    const ip = request.headers.get("CF-Connecting-IP") || "anon";
    const cuerpo = await request.json().catch(() => null);
    if (!cuerpo) return errorOpenAI("JSON inválido", 400, "invalid_request_error");

    // Modo prueba: sin cuenta se puede chatear con un cupo pequeño por IP y sin Fusión.
    // Con «requerir cuenta» desactivado, la app sin sesión se trata como antes (solo límite por minuto).
    const invitado = !cuenta && motor.ajustes.requerirCuenta !== false;
    if (invitado) {
      if (motor.ajustes.invitados === false) {
        return errorOpenAI("Para chatear necesitas una cuenta de LibreIA (es gratis y no guarda datos personales). Entra en https://libre-ia.pages.dev o actualiza la app desde https://libreia-api.libreia-chat-mobile.workers.dev/descargas/LibreIA-Chat.apk", 401, "account_required");
      }
      if (cuerpo.model === "fusion") {
        return errorOpenAI("El modo Fusión consulta varios modelos a la vez y está reservado a cuentas. Crea una cuenta gratis o usa otro modo.", 403, "account_required");
      }
      const cupo = Math.min(Math.max(Math.floor(Number(motor.ajustes.mensajesInvitado)) || 10, 1), 100);
      const esperaPrueba = await limitePorIp(env, "invitado:" + ip, cupo, 3600000);
      if (esperaPrueba > 0) {
        return errorOpenAI(`Usaste los ${cupo} mensajes de prueba de esta hora. Crea una cuenta gratis (sin datos personales) para seguir, o vuelve en ${Math.ceil(esperaPrueba / 60)} min.`, 429, "guest_limit");
      }
    }
    // Límite por minuto: un Durable Object por cuenta (o por IP sin sesión), sin escrituras de KV.
    const espera = await limitePorIp(env, cuenta ? "cuenta:" + cuenta.id : ip, motor.ajustes.limitePorMinuto);
    if (espera > 0) {
      return errorOpenAI(`Demasiadas peticiones: espera ${espera} s e inténtalo de nuevo`, 429, "rate_limit_exceeded");
    }

    // Compatibilidad: IDs antiguos de FreeLLMAPI se tratan como el modo más cercano.
    const alias = { auto: "neutral", codestral: "tecnico" };
    const pedido = typeof cuerpo.model === "string" ? cuerpo.model : "";
    const modo = Object.hasOwn(MODOS, pedido) ? pedido : Object.hasOwn(alias, pedido) ? alias[pedido] : "neutral";

    try {
      const mensajes = prepararMensajes(cuerpo.messages, modo, motor.ajustes.sistema?.[modo]);

      // Búsqueda web: referencias reales para la respuesta (la app la puede desactivar con web:false).
      let fuentes = [];
      let busqueda = null;
      const ultimo = mensajes[mensajes.length - 1].content;
      if (cuerpo.web !== false && motor.ajustes.busquedaWeb !== false && cuerpo.stream !== true && vale_la_pena_buscar(ultimo)) {
        const consulta = await consultaDeBusqueda(motor, mensajes);
        const r = await buscarWeb(consulta, Math.min(Math.max(Number(motor.ajustes.resultadosWeb) || 5, 1), 8));
        fuentes = r.fuentes;
        busqueda = { consulta, motor: r.motor, error: r.error };
        if (fuentes.length) mensajes[0] = { role: "system", content: mensajes[0].content + contextoFuentes(fuentes) };
      }

      const contar = (proveedor) => ctx.waitUntil(registrarEstadistica(env, request, [
        "mensajes", `modo:${modo}`, proveedor ? `proveedor:${proveedor}` : "fallo", ...(invitado ? ["invitado"] : []),
        ...(busqueda ? [`web:${fuentes.length ? busqueda.motor : "sin_fuentes"}`] : []),
      ]));
      if (modo === "fusion") {
        const r = await fusionar(motor, mensajes);
        contar(r.destino?.platform);
        return respuestaOpenAI({ ...r, fuentes, busqueda }, modo);
      }
      const r = await completar(motor, modo, mensajes, {
        stream: cuerpo.stream === true,
        maxTokens: cuerpo.max_tokens,
        temperatura: cuerpo.temperature,
      });
      contar(r.destino?.platform);
      if (r.stream) {
        const h = new Headers(CORS_HEADERS);
        h.set("Content-Type", "text/event-stream; charset=utf-8");
        h.set("Cache-Control", "no-cache");
        h.set("X-LibreIA-Proveedor", `${r.destino.platform}/${r.destino.model}`);
        return new Response(r.stream.body, { status: 200, headers: h });
      }
      return respuestaOpenAI({ ...r, fuentes, busqueda }, modo);
    } catch (e) {
      if (e instanceof ErrorIA && e.estado >= 500) ctx.waitUntil(registrarEstadistica(env, request, ["mensajes", `modo:${modo}`, "fallo"]));
      if (e instanceof ErrorIA) {
        const detalle = e.intentos?.length ? " — " + e.intentos.map((i) => `${i.proveedor}: ${i.error}`).join(" | ") : "";
        return errorOpenAI(e.message + detalle, e.estado, "upstream_error", e.intentos);
      }
      console.error("Error interno /v1/chat/completions:", e);
      return errorOpenAI("Error interno: " + e.message, 500, "server_error");
    }
  }

  return errorOpenAI("Ruta no encontrada", 404, "not_found");
}

/**
 * Consulta para el buscador. En una conversación, la última pregunta puede depender del contexto
 * («¿y en México?»), así que un modelo rápido la reescribe; si falla, se usa el mensaje tal cual.
 */
async function consultaDeBusqueda(motor, mensajes) {
  const delUsuario = mensajes.filter((m) => m.role === "user");
  const ultimo = delUsuario[delUsuario.length - 1].content;
  if (delUsuario.length < 2 && ultimo.length <= 200) return ultimo;
  try {
    const historial = mensajes.slice(1).slice(-6).map((m) => `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.content.slice(0, 500)}`).join("\n");
    const r = await completar(motor, "neutral", [
      { role: "system", content: "Convierte la última petición del usuario en UNA consulta corta para un buscador web (máximo 12 palabras), en su idioma, resolviendo las referencias al contexto. Responde solo con la consulta, sin comillas ni explicación." },
      { role: "user", content: historial },
    ], { maxTokens: 200, presupuestoMs: 6000 });
    const q = r.texto.split("\n")[0].replace(/^["'«“]+|["'»”]+$/g, "").trim();
    return q.length >= 3 ? q.slice(0, 200) : ultimo.slice(0, 300);
  } catch {
    return ultimo.slice(0, 300);
  }
}

// ===== Cuentas, sesiones y comunidad =====
const SESION_DIAS = 30;
const hexDe = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmacHex(secreto, texto) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hexDe(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texto)));
}

async function crearSesion(env, id) {
  const exp = Date.now() + SESION_DIAS * 86400000;
  return `s1.${id}.${exp}.${await hmacHex(env.SESSION_KEY, `s1.${id}.${exp}`)}`;
}

async function verificarSesion(env, token) {
  if (!env.SESSION_KEY) return null;
  const partes = token.split(".");
  if (partes.length !== 4) return null;
  const [, id, exp, firma] = partes;
  if (!/^[0-9a-f]{32}$/.test(id) || !(Number(exp) > Date.now())) return null;
  return igualesSeguro(firma, await hmacHex(env.SESSION_KEY, `s1.${id}.${exp}`)) ? { id } : null;
}

const comunidad = (env) => env.COMUNIDAD.get(env.COMUNIDAD.idFromName("global"));
async function llamarComunidad(env, ruta, datos, metodo = "POST") {
  const url = new URL("https://comunidad" + ruta);
  if (metodo === "GET") for (const [k, v] of Object.entries(datos || {})) url.searchParams.set(k, v);
  const res = await comunidad(env).fetch(url, metodo === "GET" ? {} : { method: "POST", body: JSON.stringify(datos || {}) });
  return { estado: res.status, datos: await res.json() };
}

/** Del par (correoHash, clave) que manda la app se derivan el id y el verificador guardados. */
async function credenciales(env, cuerpo) {
  const correoHash = String(cuerpo?.correoHash || "");
  const clave = String(cuerpo?.clave || "");
  if (!/^[0-9a-f]{64}$/.test(correoHash) || !/^[0-9a-f]{64}$/.test(clave)) return null;
  return {
    id: (await hmacHex(env.CUENTAS_PEPPER, "id:" + correoHash)).slice(0, 32),
    verificador: await hmacHex(env.CUENTAS_PEPPER, "clave:" + clave),
  };
}

async function manejarComunidad(request, env, path, cuenta) {
  if (!env.COMUNIDAD || !env.CUENTAS_PEPPER || !env.SESSION_KEY) return json({ error: "Las cuentas no están configuradas en el servidor" }, 503, CORS_HEADERS);
  const ip = request.headers.get("CF-Connecting-IP") || "anon";
  const cuerpo = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  const fallo = (msg, estado) => json({ error: msg }, estado, CORS_HEADERS);

  if (path === "/v1/cuenta/registro" && request.method === "POST") {
    // Máximo 5 cuentas nuevas por hora desde la misma IP (frena la creación masiva).
    if ((await limitePorIp(env, "registro:" + ip, 5, 3600000)) > 0) return fallo("Demasiados registros desde tu red. Inténtalo más tarde.", 429);
    const c = await credenciales(env, cuerpo);
    if (!c) return fallo("Datos de registro inválidos", 400);
    const r = await llamarComunidad(env, "/cuentas/registrar", c);
    if (r.estado !== 200) return fallo(r.datos.error, r.estado);
    return json({ ok: true, sesion: await crearSesion(env, c.id) }, 200, CORS_HEADERS);
  }

  if (path === "/v1/cuenta/entrar" && request.method === "POST") {
    if ((await limitePorIp(env, "entrar:" + ip, 10, 900000)) > 0) return fallo("Demasiados intentos. Espera 15 minutos.", 429);
    const c = await credenciales(env, cuerpo);
    if (!c) return fallo("Datos inválidos", 400);
    const r = await llamarComunidad(env, "/cuentas/verificar", c);
    if (!r.datos.ok) return fallo("Correo o contraseña incorrectos", 401);
    return json({ ok: true, sesion: await crearSesion(env, c.id) }, 200, CORS_HEADERS);
  }

  // Sin cuenta (modo prueba) solo se pueden leer las propuestas.
  if (!cuenta && path === "/v1/propuestas" && request.method === "GET") {
    const r = await llamarComunidad(env, "/propuestas", { cuenta: "" }, "GET");
    return json(r.datos, r.estado, CORS_HEADERS);
  }
  // Lo demás requiere sesión.
  if (!cuenta) return fallo("Para proponer, votar o gestionar tu cuenta necesitas entrar con tu cuenta", 401);

  if (path === "/v1/cuenta/contrasena" && request.method === "POST") {
    const actual = await credenciales(env, { correoHash: cuerpo.correoHash, clave: cuerpo.claveActual });
    const nueva = await credenciales(env, { correoHash: cuerpo.correoHash, clave: cuerpo.claveNueva });
    if (!actual || !nueva || actual.id !== cuenta.id) return fallo("Datos inválidos", 400);
    const r = await llamarComunidad(env, "/cuentas/cambiar", { id: cuenta.id, verificadorActual: actual.verificador, verificadorNuevo: nueva.verificador });
    return r.estado === 200 ? json({ ok: true }, 200, CORS_HEADERS) : fallo(r.datos.error, r.estado);
  }

  if (path === "/v1/cuenta/borrar" && request.method === "POST") {
    const c = await credenciales(env, cuerpo);
    if (!c || c.id !== cuenta.id) return fallo("Datos inválidos", 400);
    const r = await llamarComunidad(env, "/cuentas/borrar", c);
    return r.estado === 200 ? json({ ok: true }, 200, CORS_HEADERS) : fallo(r.datos.error, r.estado);
  }

  if (path === "/v1/propuestas" && request.method === "GET") {
    const r = await llamarComunidad(env, "/propuestas", { cuenta: cuenta.id }, "GET");
    return json(r.datos, r.estado, CORS_HEADERS);
  }
  if (path === "/v1/propuestas" && request.method === "POST") {
    if ((await limitePorIp(env, "propuesta:" + cuenta.id, 5, 3600000)) > 0) return fallo("Espera un poco antes de proponer otra vez", 429);
    const r = await llamarComunidad(env, "/propuestas", { cuenta: cuenta.id, titulo: cuerpo.titulo, texto: cuerpo.texto });
    return json(r.datos, r.estado, CORS_HEADERS);
  }
  if (path === "/v1/propuestas/votar" && request.method === "POST") {
    if ((await limitePorIp(env, "voto:" + cuenta.id, 60)) > 0) return fallo("Demasiados votos seguidos", 429);
    const r = await llamarComunidad(env, "/propuestas/votar", { cuenta: cuenta.id, propuesta: cuerpo.propuesta });
    return json(r.datos, r.estado, CORS_HEADERS);
  }
  return fallo("Ruta no encontrada", 404);
}

// ===== Transparencia pública =====
let cacheTransparencia = null;
async function transparencia(env, motor) {
  if (cacheTransparencia && Date.now() - cacheTransparencia.t < 300000) return cacheTransparencia.datos;
  const leer = async (fn) => { try { return await fn(); } catch { return null; } };
  const [uso, cuentas, cadena] = await Promise.all([
    leer(async () => (await env.ESTADISTICAS.get(env.ESTADISTICAS.idFromName("global")).fetch("https://e/resumen")).json()),
    leer(async () => (await llamarComunidad(env, "/cuentas/contar", {})).datos),
    leer(async () => (await (await env.ESTADISTICAS.get(env.ESTADISTICAS.idFromName("global")).fetch("https://e/valor?clave=cadena")).json()).valor),
  ]);
  const proveedores = Object.keys(motor.catalogo.providers).filter((id) => disponible(motor, id));
  const datos = {
    generado: new Date().toISOString(),
    cuentas: cuentas?.total ?? null,
    instalaciones: uso?.usuarios?.total ?? null,
    activos30: uso?.usuarios?.activos30 ?? null,
    mensajesTotal: uso?.mensajes?.total ?? null,
    mensajes30: uso?.mensajes?.dias30 ?? null,
    proveedores,
    // Modo prueba (chatear sin cuenta): la app y la web lo muestran antes de entrar.
    prueba: {
      activa: motor.ajustes.requerirCuenta === false || motor.ajustes.invitados !== false,
      mensajesPorHora: motor.ajustes.requerirCuenta === false ? null : Math.min(Math.max(Math.floor(Number(motor.ajustes.mensajesInvitado)) || 10, 1), 100),
    },
    donaciones: {
      btc: cadena?.btc ? { recibido: cadena.btc.recibido, pagos: cadena.btc.donaciones } : null,
      usdc: cadena?.usdc ? { recibido: cadena.usdc.recibido, pagos: cadena.usdc.donaciones, desde: cadena.usdc.desde } : null,
      nota: "Las direcciones de donación son compartidas con el proyecto Kumo.",
    },
    privacidad: "No se guardan mensajes, IPs, correos ni contraseñas. Solo números agregados y huellas cifradas irreversibles de las cuentas.",
  };
  cacheTransparencia = { t: Date.now(), datos };
  return datos;
}

function respuestaOpenAI(r, modo) {
  return json({
    id: "chatcmpl-" + crypto.randomUUID(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modo,
    // Algunos modelos citan como 【1】 o 【1†L3】: se normaliza a [1].
    choices: [{ index: 0, message: { role: "assistant", content: r.texto.replace(/【(\d{1,2})(?:†[^】]*)?】/g, "[$1]") }, finish_reason: r.fin || "stop" }],
    usage: r.uso || undefined,
    libreia: {
      proveedor: r.destino?.platform,
      modelo: r.destino?.model,
      ...(r.fusion ? { fusion: r.fusion } : {}),
      // Fuentes consultadas (sin el extracto: la app solo muestra título y enlace).
      fuentes: (r.fuentes || []).map(({ n, titulo, url, dominio }) => ({ n, titulo, url, dominio })),
      ...(r.busqueda ? { busqueda: r.busqueda } : {}),
    },
  }, 200, CORS_HEADERS);
}

function errorOpenAI(message, status, code, intentos) {
  return json({ error: { message, type: code, code, ...(intentos ? { intentos } : {}) } }, status, CORS_HEADERS);
}

// ===== Helpers =====
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

// ===== Límite por IP =====
const LIMITE_PETICIONES = 20;
const LIMITE_VENTANA_MS = 60000;

/** Devuelve 0 si se permite la petición, o los segundos que hay que esperar. */
async function limitePorIp(env, ip, limite = LIMITE_PETICIONES, ventana = LIMITE_VENTANA_MS) {
  if (!env.LIMITADOR || !(limite > 0)) return 0;
  try {
    const stub = env.LIMITADOR.get(env.LIMITADOR.idFromName(ip));
    const r = await stub.fetch(`https://limite/?limite=${limite}&ventana=${ventana}`);
    const { espera } = await r.json();
    return espera || 0;
  } catch (e) {
    // Si el limitador falla no se bloquea el chat, pero queda registrado.
    console.error("Limitador no disponible:", e.message);
    return 0;
  }
}

export class Limitador {
  constructor(state) {
    this.state = state;
    this.marcas = [];
  }
  // También lo usa el panel de administración para limitar intentos de login
  // (otra clave y otros valores de límite/ventana en la URL).
  async fetch(request) {
    const q = new URL(request.url).searchParams;
    const limite = Math.max(1, Number(q.get("limite")) || LIMITE_PETICIONES);
    const ventana = Math.max(1000, Number(q.get("ventana")) || LIMITE_VENTANA_MS);
    const ahora = Date.now();
    this.marcas = this.marcas.filter((t) => ahora - t < ventana);
    if (this.marcas.length >= limite) {
      const espera = Math.ceil((ventana - (ahora - this.marcas[0])) / 1000);
      return Response.json({ espera });
    }
    this.marcas.push(ahora);
    return Response.json({ espera: 0 });
  }
}
