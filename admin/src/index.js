// libreia-admin — Panel de administración de LibreIA (Worker aparte).
// Controla el Worker principal (libreia-api) sin compartir su URL pública:
//   · Lee y escribe la configuración del motor en el KV CONFIG compartido.
//   · Habla con el principal por Service Binding (MOTOR) con un token interno.
//   · Las claves de proveedores se guardan cifradas (AES-GCM, MASTER_KEY).
// Acceso con usuario y contraseña; sesión en cookie firmada (HMAC), sin escrituras de KV.

import { cifrar, descifrar, igualesSeguro } from "../../nube/src/cifrado.js";
import { CATALOGO } from "../../nube/src/catalogo.js";
import { HTML, CSS, JS } from "./ui.js";

const COOKIE = "__Host-libreia_admin";
const SESION_MS = 12 * 3600 * 1000;
const PBKDF2_ITER = 10000; // Bajo para caber en 10 ms de CPU; la contraseña es aleatoria y larga.
const MAX_REGISTRO = 60;
const LOGIN_LIMITE = 5;
const LOGIN_VENTANA_MS = 15 * 60 * 1000;

const SEGURIDAD = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Strict-Transport-Security": "max-age=31536000",
};
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
  "frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname: ruta } = url;
    try {
      if (request.method === "GET" && ruta === "/") return estatico(HTML, "text/html; charset=utf-8");
      if (request.method === "GET" && ruta === "/app.css") return estatico(CSS, "text/css; charset=utf-8");
      if (request.method === "GET" && ruta === "/app.js") return estatico(JS, "text/javascript; charset=utf-8");
      if (ruta.startsWith("/api/")) return await api(request, env, ruta, url);
      return json({ error: "No encontrado" }, 404);
    } catch (e) {
      console.error("admin:", e);
      return json({ error: `Error interno: ${e.message}` }, 500);
    }
  },
};

// ---------------------------------------------------------------- respuestas
function estatico(cuerpo, tipo) {
  return new Response(cuerpo, { headers: { ...SEGURIDAD, "Content-Type": tipo, "Content-Security-Policy": CSP } });
}
function json(datos, estado = 200, extra = {}) {
  return new Response(JSON.stringify(datos), { status: estado, headers: { ...SEGURIDAD, "Content-Type": "application/json", ...extra } });
}

// ---------------------------------------------------------------- utilidades de cripto
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function pbkdf2(contraseña, sal) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(contraseña), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(sal), iterations: PBKDF2_ITER, hash: "SHA-256" }, material, 256);
  return hex(bits);
}

async function hmac(secreto, texto) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texto)));
}

// ---------------------------------------------------------------- cuenta y sesión
/** Cuenta vigente: la del KV (si se cambió la contraseña desde el panel) o la de los secretos. */
async function cuenta(env) {
  const kv = await env.CONFIG.get("admin:cuenta", "json");
  if (kv?.usuario && kv?.hash && kv?.sal) return kv;
  if (env.ADMIN_USER && env.ADMIN_PASS_HASH && env.ADMIN_PASS_SALT) return { usuario: env.ADMIN_USER, hash: env.ADMIN_PASS_HASH, sal: env.ADMIN_PASS_SALT };
  return null;
}

// La versión de la sesión depende del hash: al cambiar la contraseña, las sesiones viejas caducan.
const versionDe = (c) => c.hash.slice(0, 12);

async function crearSesion(env, c) {
  const exp = Date.now() + SESION_MS;
  const base = `${c.usuario}.${exp}.${versionDe(c)}`;
  return `${base}.${await hmac(env.SESSION_SECRET, base)}`;
}

async function sesionValida(request, env) {
  const galleta = (request.headers.get("Cookie") || "").split(";").map((x) => x.trim()).find((x) => x.startsWith(COOKIE + "="));
  if (!galleta || !env.SESSION_SECRET) return null;
  const token = galleta.slice(COOKIE.length + 1);
  const partes = token.split(".");
  if (partes.length !== 4) return null;
  const [usuario, exp, version, firma] = partes;
  if (!igualesSeguro(firma, await hmac(env.SESSION_SECRET, `${usuario}.${exp}.${version}`))) return null;
  if (!(Number(exp) > Date.now())) return null;
  const c = await cuenta(env);
  if (!c || c.usuario !== usuario || versionDe(c) !== version) return null;
  return { usuario };
}

const galletaSesion = (token, maxAge) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

async function limiteLogin(env, ip) {
  if (!env.LIMITADOR) return 0;
  const stub = env.LIMITADOR.get(env.LIMITADOR.idFromName(`login:${ip}`));
  const r = await stub.fetch(`https://limite/?limite=${LOGIN_LIMITE}&ventana=${LOGIN_VENTANA_MS}`);
  return (await r.json()).espera || 0;
}

// ---------------------------------------------------------------- registro de acciones
// Si no se puede escribir el registro (p. ej. cuota diaria de KV agotada), la acción sigue adelante:
// el registro nunca debe impedir entrar ni administrar.
async function registrar(env, request, usuario, accion) {
  try {
    const lista = (await env.CONFIG.get("admin:registro", "json")) || [];
    lista.unshift({ t: Date.now(), usuario, ip: request.headers.get("CF-Connecting-IP") || "?", accion });
    await env.CONFIG.put("admin:registro", JSON.stringify(lista.slice(0, MAX_REGISTRO)));
  } catch (e) {
    console.error("No se pudo escribir el registro:", e.message);
  }
}

// ---------------------------------------------------------------- Worker principal
async function motor(env, ruta, opciones = {}) {
  if (!env.MOTOR) throw new Error("Falta el Service Binding MOTOR");
  const res = await env.MOTOR.fetch(`https://motor${ruta}`, {
    ...opciones,
    headers: { "Content-Type": "application/json", "X-Interno": env.INTERNAL_TOKEN || "", ...(opciones.headers || {}) },
  });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(datos.error || `El motor respondió HTTP ${res.status}`);
  return datos;
}
const recargarMotor = (env) => motor(env, "/interno/recargar", { method: "POST" }).catch((e) => console.error("recargar:", e.message));

// ---------------------------------------------------------------- uso y donaciones
// Direcciones que muestra la app (diálogo «Apoyar»). OJO: hoy son las mismas que las de Kumo,
// así que lo recibido en la cadena incluye donaciones a ambos proyectos.
const DIRECCIONES = {
  btc: "bc1qd9j45f4t0jwyhjhqh2kvz2cr7k8xye460rr2y7",
  usdc: "0xAC43f9b0E7F0ae6386cfC8ef6BFf62CE9c3006A1",
  xmr: "447gTj6Hg6gaAEAUmjqfhqDZr1PziUTvbT4LYLpmLVnTNVFK6cqeqPfh6P4neMKLWX5jDXAr94fWHacJwDvjmCzBBH8wPBt",
};
const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const RPC_ARBITRUM = "https://arb1.arbitrum.io/rpc";
const TOPIC_TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const BLOQUES_POR_CONSULTA = 9_000_000; // el nodo público admite hasta 10 M por eth_getLogs
const CACHE_CADENA_MS = 10 * 60 * 1000;

const estadisticas = (env) => env.ESTADISTICAS.get(env.ESTADISTICAS.idFromName("global"));

async function comunidad(env, ruta, datos, metodo = "POST") {
  if (!env.COMUNIDAD) throw new Error("Falta el binding COMUNIDAD");
  const stub = env.COMUNIDAD.get(env.COMUNIDAD.idFromName("global"));
  const res = await stub.fetch("https://c" + ruta, metodo === "GET" ? {} : { method: "POST", body: JSON.stringify(datos || {}) });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
  return d;
}

async function rpc(metodo, params) {
  const res = await fetch(RPC_ARBITRUM, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: metodo, params }),
    signal: AbortSignal.timeout(20000),
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  return d.result;
}

/** BTC y USDC recibidos según la cadena pública. Monero es privado: no se puede verificar desde fuera. */
async function donacionesCadena(env) {
  const stub = estadisticas(env);
  const previo = (await (await stub.fetch("https://e/valor?clave=cadena")).json()).valor;
  if (previo && Date.now() - previo.t < CACHE_CADENA_MS) return previo;

  const r = { t: Date.now(), btc: previo?.btc || null, usdc: previo?.usdc || null, errores: [] };

  try {
    const res = await fetch(`https://mempool.space/api/address/${DIRECCIONES.btc}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`mempool.space HTTP ${res.status}`);
    const a = await res.json();
    r.btc = {
      recibido: (a.chain_stats.funded_txo_sum + a.mempool_stats.funded_txo_sum) / 1e8,
      donaciones: a.chain_stats.funded_txo_count + a.mempool_stats.funded_txo_count,
      pendientes: a.mempool_stats.funded_txo_count,
      desde: "siempre",
    };
  } catch (e) {
    r.errores.push(`BTC: ${e.message}`);
  }

  try {
    const destino = "0x" + DIRECCIONES.usdc.slice(2).toLowerCase().padStart(64, "0");
    const ultimo = parseInt(await rpc("eth_blockNumber", []), 16);
    // Primera vez: se empieza a contar desde ahora (escanear toda la historia exigiría ~60 consultas).
    const u = previo?.usdc || { recibido: 0, donaciones: 0, bloque: ultimo, desde: new Date().toISOString().slice(0, 10) };
    let desde = u.bloque + 1;
    for (let i = 0; i < 3 && desde <= ultimo; i++) {
      const hasta = Math.min(desde + BLOQUES_POR_CONSULTA - 1, ultimo);
      const logs = await rpc("eth_getLogs", [{ fromBlock: "0x" + desde.toString(16), toBlock: "0x" + hasta.toString(16), address: USDC_ARBITRUM, topics: [TOPIC_TRANSFER, null, destino] }]);
      for (const l of logs) {
        u.recibido += Number(BigInt(l.data)) / 1e6;
        u.donaciones += 1;
      }
      u.bloque = hasta;
      desde = hasta + 1;
    }
    const saldo = await rpc("eth_call", [{ to: USDC_ARBITRUM, data: "0x70a08231" + destino.slice(2) }, "latest"]);
    r.usdc = { ...u, saldo: Number(BigInt(saldo)) / 1e6 };
  } catch (e) {
    r.errores.push(`USDC: ${e.message}`);
  }

  await stub.fetch("https://e/valor", { method: "PUT", body: JSON.stringify({ clave: "cadena", valor: r }) });
  return r;
}

// ---------------------------------------------------------------- validaciones
function validarCatalogo(c) {
  const errores = [];
  if (!c || typeof c !== "object") return ["El catálogo debe ser un objeto"];
  const prov = c.providers;
  if (!prov || typeof prov !== "object" || !Object.keys(prov).length) errores.push("Faltan proveedores");
  for (const [id, p] of Object.entries(prov || {})) {
    if (!/^[a-z0-9_-]{1,32}$/.test(id)) errores.push(`Id de proveedor inválido: ${id}`);
    try {
      const u = new URL(p.url);
      if (u.protocol !== "https:") errores.push(`${id}: la URL debe ser https`);
    } catch {
      errores.push(`${id}: URL inválida`);
    }
    if (!p || typeof p !== "object") { errores.push(`${id}: definición inválida`); continue; }
    if (!["bearer", "none", "x-api-key", "x-goog-api-key"].includes(p.auth)) errores.push(`${id}: auth inválido`);
    if (p.auth !== "none" && !/^KEY_[A-Z0-9_]{1,40}$/.test(p.secretName || "")) errores.push(`${id}: secretName debe ser KEY_ALGO`);
  }
  const destinoOk = (d, donde) => {
    if (!d || typeof d.platform !== "string" || !prov || !Object.hasOwn(prov, d.platform)) errores.push(`${donde}: proveedor desconocido (${d?.platform})`);
    if (!d?.model || typeof d.model !== "string" || d.model.length > 120) errores.push(`${donde}: modelo inválido`);
  };
  for (const m of ["neutral", "libre", "tecnico"]) {
    const lista = c.modes?.[m];
    if (!Array.isArray(lista) || !lista.length) errores.push(`El modo ${m} necesita al menos un modelo`);
    else lista.forEach((d, i) => destinoOk(d, `${m} #${i + 1}`));
  }
  if (!Array.isArray(c.fusion?.panel) || !c.fusion.panel.length) errores.push("Fusión necesita al menos un modelo en el panel");
  else c.fusion.panel.forEach((d, i) => destinoOk(d, `fusión panel #${i + 1}`));
  (c.fusion?.panelFallback || []).forEach((d, i) => destinoOk(d, `fusión respaldo #${i + 1}`));
  destinoOk(c.fusion?.synth, "fusión sintetizador");
  return errores;
}

function limpiarCatalogo(c) {
  const d = (x) => ({ platform: String(x.platform), model: String(x.model).trim() });
  return {
    providers: Object.fromEntries(
      Object.entries(c.providers).map(([id, p]) => [
        id,
        { url: String(p.url).trim(), auth: p.auth, secretName: p.auth === "none" ? null : p.secretName, extraHeaders: {} },
      ]),
    ),
    modes: Object.fromEntries(["neutral", "libre", "tecnico"].map((m) => [m, c.modes[m].map(d)])),
    fusion: { panel: c.fusion.panel.map(d), panelFallback: (c.fusion.panelFallback || []).map(d), synth: d(c.fusion.synth) },
  };
}

// ---------------------------------------------------------------- claves
async function leerClaves(env) {
  const cifradas = await env.CONFIG.get("motor:claves");
  return cifradas ? descifrar(env.MASTER_KEY, cifradas) : {};
}

/** Prueba una clave contra un proveedor antes de guardarla. */
async function probarClave(catalogo, nombre, valor) {
  const entrada = Object.entries(catalogo.providers).find(([, p]) => p.secretName === nombre);
  if (!entrada) return { ok: false, error: "Ningún proveedor del catálogo usa esa clave" };
  const [id, p] = entrada;
  const todos = [...Object.values(catalogo.modes).flat(), ...catalogo.fusion.panel, ...(catalogo.fusion.panelFallback || []), catalogo.fusion.synth];
  const modelo = todos.find((d) => d.platform === id)?.model;
  if (!modelo) return { ok: false, error: `El proveedor ${id} no tiene modelos en el catálogo para probar` };
  const cab = { "Content-Type": "application/json" };
  if (p.auth === "x-api-key") cab["x-api-key"] = valor;
  else if (p.auth === "x-goog-api-key") cab["x-goog-api-key"] = valor;
  else cab.Authorization = `Bearer ${valor}`;
  const inicio = Date.now();
  try {
    const res = await fetch(p.url, {
      method: "POST",
      headers: cab,
      body: JSON.stringify({ model: modelo, messages: [{ role: "user", content: "Responde solo: OK" }], max_tokens: 256 }),
      signal: AbortSignal.timeout(30000),
      redirect: "manual", // un 3xx cuenta como fallo: la clave no se reenvía a otro host
    });
    if (res.ok) return { ok: true, ms: Date.now() - inicio, modelo };
    const t = await res.text().catch(() => "");
    return { ok: false, error: `HTTP ${res.status}: ${t.slice(0, 160)}`, modelo };
  } catch (e) {
    return { ok: false, error: e.message, modelo };
  }
}

// ---------------------------------------------------------------- API
async function api(request, env, ruta, url) {
  const metodo = request.method;

  // Peticiones que cambian algo: solo desde el propio origen y en JSON (defensa CSRF extra a SameSite=Strict).
  if (metodo !== "GET") {
    const origen = request.headers.get("Origin");
    if (origen && origen !== url.origin) return json({ error: "Origen no permitido" }, 403);
    if (!/^application\/json(\s*;|$)/i.test(request.headers.get("Content-Type") || "")) return json({ error: "Se requiere JSON" }, 415);
  }

  if (ruta === "/api/login" && metodo === "POST") {
    const ip = request.headers.get("CF-Connecting-IP") || "anon";
    const espera = await limiteLogin(env, ip);
    if (espera > 0) return json({ error: `Demasiados intentos. Espera ${Math.ceil(espera / 60)} min.` }, 429);
    const c = await cuenta(env);
    if (!c || !env.SESSION_SECRET) return json({ error: "El panel no está configurado (faltan secretos)" }, 503);
    const { usuario, contraseña } = await request.json().catch(() => ({}));
    const hash = await pbkdf2(String(contraseña || ""), c.sal);
    // Se compara siempre el hash (aunque el usuario no coincida) para no filtrar cuál falló.
    const ok = igualesSeguro(hash, c.hash) & igualesSeguro(String(usuario || ""), c.usuario);
    if (!ok) return json({ error: "Usuario o contraseña incorrectos" }, 401);
    await registrar(env, request, c.usuario, "Inicio de sesión");
    return json({ ok: true, usuario: c.usuario }, 200, { "Set-Cookie": galletaSesion(await crearSesion(env, c), SESION_MS / 1000) });
  }

  if (ruta === "/api/logout" && metodo === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": galletaSesion("", 0) });
  }

  // A partir de aquí, todo requiere sesión.
  const sesion = await sesionValida(request, env);
  if (!sesion) return json({ error: "Sesión no válida o caducada" }, 401);
  const usuario = sesion.usuario;

  if (ruta === "/api/sesion" && metodo === "GET") return json({ usuario });

  if (ruta === "/api/estado" && metodo === "GET") {
    return json(await motor(env, "/interno/estado"));
  }

  if (ruta === "/api/probar" && metodo === "POST") {
    const { platform, model, modo } = await request.json().catch(() => ({}));
    return json(await motor(env, "/interno/probar", { method: "POST", body: JSON.stringify({ platform, model, modo }) }));
  }

  // --- claves
  const mClave = ruta.match(/^\/api\/claves\/(KEY_[A-Z0-9_]{1,40})$/);
  if (mClave && metodo === "PUT") {
    if (!env.MASTER_KEY) return json({ error: "Falta MASTER_KEY en el panel" }, 503);
    const nombre = mClave[1];
    const { valor } = await request.json().catch(() => ({}));
    const limpio = String(valor || "").trim();
    if (limpio.length < 8 || limpio.length > 400 || /\s/.test(limpio)) return json({ error: "La clave no parece válida (longitud o espacios)" }, 400);
    const catalogo = (await env.CONFIG.get("motor:catalogo", "json")) || CATALOGO;
    const prueba = await probarClave(catalogo, nombre, limpio);
    if (!prueba.ok) return json({ error: `La clave no funcionó con ${prueba.modelo || "el proveedor"}: ${prueba.error}. No se guardó.` }, 422);
    const claves = await leerClaves(env);
    claves[nombre] = limpio;
    await env.CONFIG.put("motor:claves", await cifrar(env.MASTER_KEY, claves));
    await registrar(env, request, usuario, `Clave ${nombre} guardada (…${limpio.slice(-4)})`);
    await recargarMotor(env);
    return json({ ok: true, prueba });
  }
  if (mClave && metodo === "DELETE") {
    const nombre = mClave[1];
    const claves = await leerClaves(env);
    if (!(nombre in claves)) return json({ error: "Esa clave no está guardada en el panel" }, 404);
    delete claves[nombre];
    await env.CONFIG.put("motor:claves", await cifrar(env.MASTER_KEY, claves));
    await registrar(env, request, usuario, `Clave ${nombre} quitada del panel`);
    await recargarMotor(env);
    return json({ ok: true });
  }

  // --- catálogo (motor)
  if (ruta === "/api/catalogo" && metodo === "GET") {
    const guardado = await env.CONFIG.get("motor:catalogo", "json");
    return json({ catalogo: guardado || CATALOGO, personalizado: !!guardado, porDefecto: CATALOGO });
  }
  if (ruta === "/api/catalogo" && metodo === "PUT") {
    const { catalogo, contraseña } = await request.json().catch(() => ({}));
    const errores = validarCatalogo(catalogo);
    if (errores.length) return json({ error: "El catálogo tiene errores", errores }, 400);
    // Mandar una clave a otro servidor es la forma de robarla: si cambia el host de un proveedor
    // con clave (o una clave pasa a otro host), se exige de nuevo la contraseña.
    const actual = (await env.CONFIG.get("motor:catalogo", "json")) || CATALOGO;
    const hostsPorClave = {};
    for (const p of Object.values(actual.providers)) if (p.secretName) (hostsPorClave[p.secretName] ||= new Set()).add(new URL(p.url).host);
    const cambios = Object.entries(catalogo.providers)
      .filter(([, p]) => p.auth !== "none" && hostsPorClave[p.secretName] && !hostsPorClave[p.secretName].has(new URL(p.url).host))
      .map(([id, p]) => `${id} → ${new URL(p.url).host}`);
    if (cambios.length) {
      const c = await cuenta(env);
      if (!contraseña || !igualesSeguro(await pbkdf2(String(contraseña), c.sal), c.hash)) {
        return json({ error: `Confirma con tu contraseña: estas claves se enviarían a otro servidor: ${cambios.join(", ")}`, requiereContraseña: true, cambios }, 403);
      }
      await registrar(env, request, usuario, `Clave enviada a otro host confirmada con contraseña: ${cambios.join(", ")}`);
    }
    await env.CONFIG.put("motor:catalogo", JSON.stringify(limpiarCatalogo(catalogo)));
    await registrar(env, request, usuario, "Catálogo del motor actualizado");
    await recargarMotor(env);
    return json({ ok: true });
  }
  if (ruta === "/api/catalogo" && metodo === "DELETE") {
    await env.CONFIG.delete("motor:catalogo");
    await registrar(env, request, usuario, "Catálogo restaurado al de fábrica");
    await recargarMotor(env);
    return json({ ok: true });
  }

  // --- ajustes
  if (ruta === "/api/ajustes" && metodo === "PUT") {
    const a = await request.json().catch(() => ({}));
    const limite = Math.floor(Number(a.limitePorMinuto));
    if (!(limite >= 1 && limite <= 600)) return json({ error: "El límite por minuto debe estar entre 1 y 600" }, 400);
    const sistema = {};
    for (const m of ["neutral", "libre", "tecnico", "fusion"]) {
      const t = String(a.sistema?.[m] || "").trim();
      if (t.length > 4000) return json({ error: `Las instrucciones de ${m} superan 4000 caracteres` }, 400);
      if (t) sistema[m] = t;
    }
    const ajustes = {
      limitePorMinuto: limite,
      mantenimiento: a.mantenimiento === true,
      mensajeMantenimiento: String(a.mensajeMantenimiento || "").trim().slice(0, 300) || "LibreIA está en mantenimiento. Vuelve a intentarlo en unos minutos.",
      sistema,
      busquedaWeb: a.busquedaWeb !== false,
      requerirCuenta: a.requerirCuenta !== false,
      invitados: a.invitados !== false,
      mensajesInvitado: Math.min(Math.max(Math.floor(Number(a.mensajesInvitado)) || 10, 1), 100),
      resultadosWeb: Math.min(Math.max(Math.floor(Number(a.resultadosWeb)) || 5, 1), 8),
    };
    await env.CONFIG.put("motor:ajustes", JSON.stringify(ajustes));
    await registrar(env, request, usuario, `Ajustes guardados (límite ${limite}/min${ajustes.mantenimiento ? ", MANTENIMIENTO ACTIVO" : ""})`);
    await recargarMotor(env);
    return json({ ok: true, ajustes });
  }

  // --- uso (estadísticas anónimas agregadas) y donaciones
  if (ruta === "/api/uso" && metodo === "GET") {
    if (!env.ESTADISTICAS) return json({ error: "Falta el binding ESTADISTICAS" }, 503);
    const [resumen, cadena, cuentas] = await Promise.all([
      estadisticas(env).fetch("https://e/resumen").then((r) => r.json()),
      donacionesCadena(env).catch((e) => ({ errores: [e.message] })),
      env.COMUNIDAD ? comunidad(env, "/cuentas/contar").catch(() => null) : null,
    ]);
    return json({ ...resumen, cadena, cuentas, direcciones: DIRECCIONES });
  }

  // --- comunidad (moderación de propuestas)
  if (ruta === "/api/propuestas" && metodo === "GET") {
    return json(await comunidad(env, "/propuestas", null, "GET"));
  }
  if (ruta === "/api/propuestas/estado" && metodo === "POST") {
    const { propuesta, estado, respuesta } = await request.json().catch(() => ({}));
    const r = await comunidad(env, "/propuestas/estado", { propuesta, estado, respuesta });
    await registrar(env, request, usuario, `Propuesta #${Number(propuesta)} → ${estado}`);
    return json(r);
  }
  if (ruta === "/api/propuestas/borrar" && metodo === "POST") {
    const { propuesta } = await request.json().catch(() => ({}));
    const r = await comunidad(env, "/propuestas/borrar", { propuesta });
    await registrar(env, request, usuario, `Propuesta #${Number(propuesta)} borrada`);
    return json(r);
  }

  // --- registro
  if (ruta === "/api/registro" && metodo === "GET") {
    return json({ registro: (await env.CONFIG.get("admin:registro", "json")) || [] });
  }

  // --- cuenta
  if (ruta === "/api/contrasena" && metodo === "POST") {
    const { actual, nueva } = await request.json().catch(() => ({}));
    const c = await cuenta(env);
    if (!igualesSeguro(await pbkdf2(String(actual || ""), c.sal), c.hash)) return json({ error: "La contraseña actual no es correcta" }, 401);
    const n = String(nueva || "");
    if (n.length < 12) return json({ error: "La nueva contraseña debe tener al menos 12 caracteres" }, 400);
    const sal = hex(crypto.getRandomValues(new Uint8Array(16)));
    const nuevaCuenta = { usuario: c.usuario, hash: await pbkdf2(n, sal), sal };
    await env.CONFIG.put("admin:cuenta", JSON.stringify(nuevaCuenta));
    await registrar(env, request, usuario, "Contraseña cambiada");
    // La sesión actual se renueva; las demás caducan porque cambió la versión.
    return json({ ok: true }, 200, { "Set-Cookie": galletaSesion(await crearSesion(env, nuevaCuenta), SESION_MS / 1000) });
  }

  return json({ error: "Ruta no encontrada" }, 404);
}
