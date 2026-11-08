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

const VERSION = "3.2.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Origin, X-Requested-With, X-LibreIA-Instalacion, X-LibreIA-Plataforma, X-LibreIA-Version",
};

export default {
  // Cualquier excepción no prevista sale como JSON con CORS (no como la página HTML de error de
  // Cloudflare, que la app no puede leer). El detalle se queda en el registro del Worker.
  async fetch(request, env, ctx) {
    try {
      return await enrutar(request, env, ctx);
    } catch (e) {
      console.error("Error no controlado:", e?.stack || e);
      return json({ error: { message: "Error interno del servidor. Inténtalo de nuevo.", type: "server_error", code: "server_error" } }, 500, CORS_HEADERS);
    }
  },
};

async function enrutar(request, env, ctx) {
  {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Health check público: solo lo imprescindible (el detalle está en /interno/estado).
    if (path === "/health") {
      const motor = await cargarMotor(env);
      return json({ ok: !motor.avisos.length, service: "libreia-api", version: VERSION, mantenimiento: !!motor.ajustes.mantenimiento }, 200, CORS_HEADERS);
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
  }
}

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
    cacheTransparencia = null;
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
        // Solo el panel ve el detalle completo de cada proveedor.
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
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");

  // Transparencia: números públicos agregados, sin token.
  if (path === "/v1/transparencia" && request.method === "GET") {
    return json(await transparencia(env, await cargarMotor(env)), 200, { ...CORS_HEADERS, "Cache-Control": "public, max-age=120" });
  }

  // Quién llama: una cuenta (token de sesión "s2."/"s1.") o la app sin sesión (token público de la app).
  // Se comprueba antes de cargar la configuración: una petición sin token no cuesta lecturas de KV.
  const esSesion = /^s[12]\./.test(token);
  const cuenta = esSesion ? await verificarSesion(env, token) : null;
  // APP_TOKEN_ANTERIOR (secreto, opcional): mantiene funcionando las APK publicadas antes de rotar el token.
  const esApp = (!!env.APP_TOKEN && igualesSeguro(token, env.APP_TOKEN)) || (!!env.APP_TOKEN_ANTERIOR && igualesSeguro(token, env.APP_TOKEN_ANTERIOR));
  if (!cuenta && !esApp) {
    return errorOpenAI(esSesion ? "Tu sesión caducó: vuelve a entrar con tu correo y contraseña" : "Token inválido", 401, "invalid_api_key");
  }
  const motor = await cargarMotor(env);
  const red = claveRed(request);

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
    if ((await limitePorIp(env, "ev:" + red, 30)) > 0) return json({ ok: false, error: "demasiados eventos" }, 429, CORS_HEADERS);
    const { tipo } = (await leerCuerpo(request, 2048)) || {};
    if (typeof tipo !== "string" || !EVENTOS_APP.has(tipo)) return json({ ok: false, error: "evento desconocido" }, 400, CORS_HEADERS);
    ctx.waitUntil(registrarEstadistica(env, request, [`evento:${tipo}`]));
    return json({ ok: true }, 200, CORS_HEADERS);
  }

  if (path === "/v1/chat/completions" && request.method === "POST") {
    if (motor.ajustes.mantenimiento) {
      return errorOpenAI(motor.ajustes.mensajeMantenimiento, 503, "maintenance");
    }
    const inicioPeticion = Date.now();
    const cuerpo = await leerCuerpo(request, MAX_CUERPO_CHAT);
    if (cuerpo === TOO_LARGE) return errorOpenAI("La conversación es demasiado grande. Empieza un chat nuevo.", 413, "invalid_request_error");
    if (!cuerpo || typeof cuerpo !== "object") return errorOpenAI("JSON inválido", 400, "invalid_request_error");

    // Compatibilidad: IDs antiguos de FreeLLMAPI se tratan como el modo más cercano.
    const alias = { auto: "neutral", codestral: "tecnico" };
    const pedido = typeof cuerpo.model === "string" ? cuerpo.model : "";
    const modo = Object.hasOwn(MODOS, pedido) ? pedido : Object.hasOwn(alias, pedido) ? alias[pedido] : "neutral";

    // Modo prueba: sin cuenta se puede chatear con un cupo pequeño y sin Fusión.
    // Con «requerir cuenta» desactivado, la app sin sesión se trata como antes (solo límite por minuto).
    const invitado = !cuenta && motor.ajustes.requerirCuenta !== false;
    if (invitado && motor.ajustes.invitados === false) {
      return errorOpenAI("Para chatear necesitas una cuenta de LibreIA (es gratis y no guarda datos personales). Entra en https://libre-ia.pages.dev o actualiza la app desde https://libreia-api.libreia-chat-mobile.workers.dev/descargas/LibreIA-Chat.apk", 401, "account_required");
    }
    if (invitado && modo === "fusion") {
      return errorOpenAI("El modo Fusión consulta varios modelos a la vez y está reservado a cuentas. Crea una cuenta gratis o usa otro modo.", 403, "account_required");
    }
    // 1) Límite por minuto (por cuenta, o por red sin sesión).
    const espera = await limitePorIp(env, cuenta ? "cuenta:" + cuenta.id : red, motor.ajustes.limitePorMinuto);
    if (espera > 0) {
      return errorOpenAI(`Demasiadas peticiones: espera ${espera} s e inténtalo de nuevo`, 429, "rate_limit_exceeded");
    }
    // 2) Validar la conversación antes de gastar cupo (una petición mal formada no cuenta).
    let mensajes;
    try {
      mensajes = prepararMensajes(cuerpo.messages, modo, motor.ajustes.sistema?.[modo], { maxCaracteres: invitado ? MAX_CARACTERES_INVITADO : undefined });
    } catch (e) {
      if (e instanceof ErrorIA) return errorOpenAI(e.message, e.estado, "invalid_request_error");
      throw e;
    }
    // 3) Cupos largos, guardados de forma persistente y cerrados si el limitador falla.
    const gastados = []; // claves a devolver si la respuesta falla por culpa del servidor
    if (invitado) {
      const cupo = Math.min(Math.max(Math.floor(Number(motor.ajustes.mensajesInvitado)) || 10, 1), 100);
      // Cupo por instalación (si la app la manda) y un tope por red algo mayor: varias personas
      // detrás de la misma IP (redes móviles con CGNAT) no se quedan sin prueba entre ellas.
      const inst = request.headers.get("X-LibreIA-Instalacion") || "";
      const claves = /^[0-9a-f-]{36}$/i.test(inst)
        ? [["invitado:i:" + inst.toLowerCase(), cupo], ["invitado:" + red, cupo * 6]]
        : [["invitado:" + red, cupo]];
      for (const [clave, limite] of claves) {
        const esperaPrueba = await limitePorIp(env, clave, limite, 3600000, { cerrado: true });
        if (esperaPrueba > 0) {
          await Promise.all(gastados.map((k) => devolverCupo(env, k)));
          return errorOpenAI(`Usaste los ${cupo} mensajes de prueba de esta hora. Crea una cuenta gratis (sin datos personales) para seguir, o vuelve en ${Math.ceil(esperaPrueba / 60)} min.`, 429, "guest_limit");
        }
        gastados.push(clave);
      }
    } else if (cuenta) {
      // Tope diario por cuenta (Fusión cuenta por 4: consulta varios modelos).
      const diario = Math.min(Math.max(Math.floor(Number(motor.ajustes.mensajesDiaCuenta)) || 300, 10), 5000);
      const esperaDia = await limitePorIp(env, "dia:" + cuenta.id, diario, 86400000, { peso: modo === "fusion" ? 4 : 1 });
      if (esperaDia > 0) {
        return errorOpenAI(`Llegaste al máximo diario de mensajes (${diario}). LibreIA usa cuotas gratuitas compartidas; vuelve en ${Math.ceil(esperaDia / 3600)} h.`, 429, "daily_limit");
      }
    }

    try {

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
      // La app espera 100 s: la búsqueda ya gastó parte del tiempo, la IA usa lo que queda.
      const presupuestoMs = Math.max(20000, PRESUPUESTO_TOTAL_MS - (Date.now() - inicioPeticion));
      if (modo === "fusion") {
        const r = await fusionar(motor, mensajes, { presupuestoMs });
        contar(r.destino?.platform);
        return respuestaOpenAI({ ...r, fuentes, busqueda }, modo);
      }
      const r = await completar(motor, modo, mensajes, {
        stream: cuerpo.stream === true,
        maxTokens: cuerpo.max_tokens,
        temperatura: cuerpo.temperature,
        presupuestoMs,
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
      // Si falló el servidor (no la petición), el mensaje de prueba se devuelve al cupo.
      if (!(e instanceof ErrorIA) || e.estado >= 500) ctx.waitUntil(Promise.all(gastados.map((k) => devolverCupo(env, k))));
      if (e instanceof ErrorIA && e.estado >= 500) ctx.waitUntil(registrarEstadistica(env, request, ["mensajes", `modo:${modo}`, "fallo"]));
      if (e instanceof ErrorIA) {
        // Al cliente solo le llega una categoría por proveedor; el texto del proveedor (que puede
        // incluir ids de organización o el consumo de cuota) se queda en el registro del Worker.
        if (e.intentos?.length) console.warn("Proveedores fallaron:", JSON.stringify(e.intentos));
        const intentos = (e.intentos || []).map((i) => ({ proveedor: i.proveedor, motivo: categoria(i.error) }));
        const resumen = intentos.length ? " — " + intentos.map((i) => `${i.proveedor}: ${i.motivo}`).join(" | ") : "";
        return errorOpenAI(e.message + resumen, e.estado, "upstream_error", intentos);
      }
      console.error("Error interno /v1/chat/completions:", e?.stack || e);
      return errorOpenAI("Error interno del servidor. Inténtalo de nuevo.", 500, "server_error");
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
    ], { maxTokens: 200, presupuestoMs: 6000, sinEnfriar: true });
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

// Sesión s2: incluye la versión de la cuenta, que sube al cambiar la contraseña. Así, cambiarla
// (o borrar la cuenta) cierra las demás sesiones. Las s1 antiguas valen mientras la versión sea 0.
async function crearSesion(env, id, ver = 0) {
  const exp = Date.now() + SESION_DIAS * 86400000;
  const base = `s2.${id}.${ver}.${exp}`;
  return `${base}.${await hmacHex(env.SESSION_KEY, base)}`;
}

const versiones = new Map(); // id → { ver, t }: caché por isolate de la versión vigente (60 s)
// Las versiones solo suben. Si el token trae una más nueva que la guardada, la caché de este isolate
// está vieja (otro isolate atendió el cambio de contraseña o el «salir») y se vuelve a consultar.
async function versionVigente(env, id, verToken) {
  const c = versiones.get(id);
  if (c && Date.now() - c.t < 60000 && !(c.ver !== null && verToken > c.ver)) return c.ver;
  const r = await llamarComunidad(env, "/cuentas/version", { id });
  if (r.estado !== 200) return undefined; // el servicio de cuentas falló: no se echa a nadie por eso
  if (versiones.size > 5000) versiones.clear();
  versiones.set(id, { ver: r.datos.ver, t: Date.now() });
  return r.datos.ver;
}

async function verificarSesion(env, token) {
  if (!env.SESSION_KEY) return null;
  const partes = token.split(".");
  let id, ver, exp, firma, base;
  if (partes[0] === "s2" && partes.length === 5) {
    [, id, ver, exp, firma] = partes;
    base = `s2.${id}.${ver}.${exp}`;
  } else if (partes[0] === "s1" && partes.length === 4) {
    [, id, exp, firma] = partes;
    ver = "0";
    base = `s1.${id}.${exp}`;
  } else return null;
  if (!/^[0-9a-f]{32}$/.test(id) || !/^\d{1,9}$/.test(ver) || !(Number(exp) > Date.now())) return null;
  if (!igualesSeguro(firma, await hmacHex(env.SESSION_KEY, base))) return null;
  const vigente = await versionVigente(env, id, Number(ver));
  if (vigente === null) return null; // la cuenta ya no existe
  if (vigente !== undefined && vigente !== Number(ver)) return null; // contraseña cambiada después
  return { id };
}

const comunidad = (env) => env.COMUNIDAD.get(env.COMUNIDAD.idFromName("global"));
async function llamarComunidad(env, ruta, datos, metodo = "POST") {
  try {
    const url = new URL("https://comunidad" + ruta);
    if (metodo === "GET") for (const [k, v] of Object.entries(datos || {})) url.searchParams.set(k, v);
    const res = await comunidad(env).fetch(url, metodo === "GET" ? {} : { method: "POST", body: JSON.stringify(datos || {}) });
    return { estado: res.status, datos: await res.json() };
  } catch (e) {
    console.error("Comunidad no disponible:", e?.message || e);
    return { estado: 503, datos: { error: "El servicio de cuentas no está disponible ahora. Inténtalo en un momento." } };
  }
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
  const red = claveRed(request);
  const leido = request.method === "POST" ? await leerCuerpo(request, 16 * 1024) : {};
  if (leido === TOO_LARGE) return json({ error: "Petición demasiado grande" }, 413, CORS_HEADERS);
  const cuerpo = leido && typeof leido === "object" ? leido : {};
  const fallo = (msg, estado) => json({ error: msg }, estado, CORS_HEADERS);

  if (path === "/v1/cuenta/registro" && request.method === "POST") {
    // Máximo 5 cuentas nuevas por hora desde la misma red y un tope global diario (frena la creación masiva).
    if ((await limitePorIp(env, "registro:" + red, 5, 3600000, { cerrado: true })) > 0) return fallo("Demasiados registros desde tu red. Inténtalo más tarde.", 429);
    if ((await limitePorIp(env, "registro:global", 500, 86400000, { cerrado: true })) > 0) return fallo("Hoy se alcanzó el máximo de cuentas nuevas. Inténtalo mañana o usa el modo prueba.", 429);
    const c = await credenciales(env, cuerpo);
    if (!c) return fallo("Datos de registro inválidos", 400);
    const r = await llamarComunidad(env, "/cuentas/registrar", c);
    if (r.estado !== 200) return fallo(r.datos.error, r.estado);
    return json({ ok: true, sesion: await crearSesion(env, c.id, 0) }, 200, CORS_HEADERS);
  }

  if (path === "/v1/cuenta/entrar" && request.method === "POST") {
    if ((await limitePorIp(env, "entrar:" + red, 10, 900000, { cerrado: true })) > 0) return fallo("Demasiados intentos. Espera 15 minutos.", 429);
    const c = await credenciales(env, cuerpo);
    if (!c) return fallo("Datos inválidos", 400);
    // También por cuenta: cambiar de IP no da más intentos contra la misma cuenta.
    if ((await limitePorIp(env, "entrar-id:" + c.id, 10, 3600000, { cerrado: true })) > 0) return fallo("Demasiados intentos para esta cuenta. Espera una hora.", 429);
    const r = await llamarComunidad(env, "/cuentas/verificar", c);
    if (r.estado !== 200) return fallo(r.datos.error, r.estado);
    if (!r.datos.ok) return fallo("Correo o contraseña incorrectos", 401);
    return json({ ok: true, sesion: await crearSesion(env, c.id, r.datos.ver || 0) }, 200, CORS_HEADERS);
  }

  // Sin cuenta (modo prueba) solo se pueden leer las propuestas.
  if (path === "/v1/propuestas" && request.method === "GET" && (await limitePorIp(env, "leer:" + red, 60)) > 0) {
    return fallo("Demasiadas consultas seguidas. Espera un momento.", 429);
  }
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
    if ((await limitePorIp(env, "entrar-id:" + cuenta.id, 10, 3600000, { cerrado: true })) > 0) return fallo("Demasiados intentos. Espera una hora.", 429);
    const r = await llamarComunidad(env, "/cuentas/cambiar", { id: cuenta.id, verificadorActual: actual.verificador, verificadorNuevo: nueva.verificador });
    if (r.estado !== 200) return fallo(r.datos.error, r.estado);
    // Las demás sesiones caducan (sube la versión); esta recibe una sesión nueva.
    versiones.delete(cuenta.id);
    return json({ ok: true, sesion: await crearSesion(env, cuenta.id, r.datos.ver) }, 200, CORS_HEADERS);
  }

  if (path === "/v1/cuenta/salir" && request.method === "POST") {
    const r = await llamarComunidad(env, "/cuentas/salir", { id: cuenta.id });
    versiones.delete(cuenta.id);
    return r.estado === 200 ? json({ ok: true }, 200, CORS_HEADERS) : fallo(r.datos.error, r.estado);
  }

  if (path === "/v1/cuenta/borrar" && request.method === "POST") {
    const c = await credenciales(env, cuerpo);
    if (!c || c.id !== cuenta.id) return fallo("Datos inválidos", 400);
    if ((await limitePorIp(env, "entrar-id:" + cuenta.id, 10, 3600000, { cerrado: true })) > 0) return fallo("Demasiados intentos. Espera una hora.", 429);
    const r = await llamarComunidad(env, "/cuentas/borrar", c);
    if (r.estado === 200) versiones.delete(cuenta.id);
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

/**
 * Devuelve 0 si se permite la petición, o los segundos que hay que esperar.
 * Las ventanas de más de un minuto se guardan de forma persistente (no se reinician al expulsar
 * el objeto). Con cerrado:true, si el limitador falla se deniega (cupos de prueba, registro, login);
 * el límite por minuto de quien ya tiene cuenta se deja pasar para no tumbar el chat.
 */
async function limitePorIp(env, clave, limite = LIMITE_PETICIONES, ventana = LIMITE_VENTANA_MS, { cerrado = false, peso = 1 } = {}) {
  if (!env.LIMITADOR || !(limite > 0)) return 0;
  try {
    const stub = env.LIMITADOR.get(env.LIMITADOR.idFromName(clave));
    const r = await stub.fetch(`https://limite/?limite=${limite}&ventana=${ventana}&peso=${peso}${ventana > 60000 ? "&persistir=1" : ""}`);
    const { espera } = await r.json();
    return espera || 0;
  } catch (e) {
    console.error("Limitador no disponible:", e.message);
    return cerrado ? 60 : 0;
  }
}

/** Devuelve la última marca de un cupo (la respuesta falló por culpa del servidor). */
async function devolverCupo(env, clave) {
  try {
    await env.LIMITADOR.get(env.LIMITADOR.idFromName(clave)).fetch("https://limite/?devolver=1&persistir=1");
  } catch {
    /* sin importancia */
  }
}

/** Red del cliente: la IPv4 entera o el prefijo /64 de la IPv6 (quien tiene una IPv6 suele tener el bloque). */
function claveRed(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "anon";
  if (!ip.includes(":")) return ip;
  const [cabeza, cola = ""] = ip.toLowerCase().split("::");
  const a = cabeza ? cabeza.split(":") : [];
  const b = cola ? cola.split(":") : [];
  const completa = [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b];
  return completa.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

const TOO_LARGE = Symbol("demasiado grande");
const MAX_CUERPO_CHAT = 300 * 1024;
const MAX_CARACTERES_INVITADO = 8000;
const PRESUPUESTO_TOTAL_MS = 88000;

/** Lee un JSON con tope de tamaño. Devuelve null si no es JSON y TOO_LARGE si se pasa. */
async function leerCuerpo(request, max) {
  if (Number(request.headers.get("Content-Length") || 0) > max) return TOO_LARGE;
  const texto = await request.text().catch(() => "");
  if (texto.length > max) return TOO_LARGE;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

/** Categoría pública de un fallo de proveedor (sin el texto del proveedor). */
function categoria(error) {
  const t = String(error || "");
  if (/tiempo agotado|sin tiempo|timeout/i.test(t)) return "tiempo agotado";
  if (/HTTP 429/.test(t)) return "cuota agotada";
  if (/HTTP 40[13]/.test(t)) return "clave rechazada";
  if (/HTTP 4\d\d/.test(t)) return "petición rechazada";
  if (/HTTP 5\d\d/.test(t)) return "proveedor caído";
  if (/vac[ií]a/.test(t)) return "respuesta vacía";
  return "no disponible";
}

export class Limitador {
  constructor(state) {
    this.state = state;
    this.marcas = [];
    this.cargado = false;
  }
  // También lo usa el panel de administración para limitar intentos de login
  // (otra clave y otros valores de límite/ventana en la URL).
  // Con persistir=1 el contador se guarda en el almacenamiento del objeto: así no se reinicia
  // cuando Cloudflare lo expulsa de memoria o se redespliega (logins, cupo del modo prueba).
  async fetch(request) {
    const q = new URL(request.url).searchParams;
    const limite = Math.min(Math.max(1, Number(q.get("limite")) || LIMITE_PETICIONES), 1000);
    const ventana = Math.min(Math.max(1000, Number(q.get("ventana")) || LIMITE_VENTANA_MS), 86400000);
    const persistir = q.get("persistir") === "1";
    if (persistir && !this.cargado) {
      this.marcas = (await this.state.storage.get("marcas")) || [];
      this.cargado = true;
    }
    if (q.get("devolver") === "1") {
      this.marcas.pop();
      if (persistir) await this.state.storage.put("marcas", this.marcas);
      return Response.json({ ok: true });
    }
    const peso = Math.min(Math.max(1, Math.floor(Number(q.get("peso")) || 1)), 10);
    const ahora = Date.now();
    this.marcas = this.marcas.filter((t) => ahora - t < ventana);
    if (this.marcas.length + peso > limite) {
      const espera = Math.max(1, Math.ceil((ventana - (ahora - (this.marcas[0] ?? ahora))) / 1000));
      return Response.json({ espera });
    }
    for (let i = 0; i < peso; i++) this.marcas.push(ahora);
    if (persistir) {
      await this.state.storage.put("marcas", this.marcas);
      // Cuando pase la ventana sin actividad, se borra todo (no quedan datos de esa red o cuenta).
      await this.state.storage.setAlarm(ahora + ventana);
    }
    return Response.json({ espera: 0 });
  }

  async alarm() {
    this.marcas = [];
    this.cargado = true;
    await this.state.storage.deleteAll();
  }
}
