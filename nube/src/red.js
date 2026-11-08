// Red de nodos LibreIA (experimental): personas voluntarias prestan su ordenador para que su modelo
// local (Ollama, LM Studio, llama.cpp, KoboldCpp…) responda a quien use el modo Comunidad.
//
// Cómo funciona:
//   · El voluntario ejecuta el conector (nodo/libreia-nodo.mjs). El conector abre un WebSocket de
//     SALIDA hacia aquí, así que no hace falta abrir puertos ni tener IP pública.
//   · Primer mensaje: {tipo:"hola", token, modelos, nombre}. El token de nodo lo genera la app con
//     una cuenta (n1.cuenta.nodo.ver.firma) y deja de valer si la cuenta cierra todas sus sesiones.
//   · Antes de recibir tráfico, el nodo responde una pregunta de control con respuesta conocida.
//   · Cada pregunta va a un nodo libre (uno por nodo a la vez); si falla o tarda, el modo Comunidad
//     pasa a AI Horde.
//
// Plan gratuito: WebSockets con hibernación. Los «ping» del conector los contesta Cloudflare sin
// despertar al objeto, y el estado de cada nodo vive en su attachment, no en memoria.
//
// Privacidad: quien ejecuta un nodo PUEDE ver las preguntas que responde; la app lo avisa antes de
// activar el modo. Aquí no se guarda ningún mensaje: solo contadores por nodo.

const ESPERA_HOLA_MS = 15000;
const TIEMPO_CONTROL_MS = 120000;
const MAX_MENSAJE = 64 * 1024;
const MAX_TEXTO = 32000;
const MAX_NODOS = 200;

// Preguntas de control: la respuesta correcta es un número fácil de comprobar.
const CONTROLES = [
  { pregunta: "¿Cuánto es 17 + 25? Responde solo con el número.", respuesta: "42" },
  { pregunta: "¿Cuánto es 9 × 7? Responde solo con el número.", respuesta: "63" },
  { pregunta: "¿Cuántos días tiene una semana? Responde solo con el número.", respuesta: "7" },
  { pregunta: "¿Cuánto es 100 − 1? Responde solo con el número.", respuesta: "99" },
];

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function hmacHex(secreto, texto) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texto)));
}
function igual(a, b) {
  const x = String(a), y = String(b || "");
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return d === 0;
}
const limpio = (t, max) => String(t || "").replace(/[^\w .:/@+-]/g, "").trim().slice(0, max);

/** Token de nodo: n1.<cuenta 32 hex>.<nodo 16 hex>.<versión de la cuenta>.<firma>. */
export async function crearTokenNodo(env, cuentaId, ver) {
  const nodo = hex(crypto.getRandomValues(new Uint8Array(8)));
  const base = `n1.${cuentaId}.${nodo}.${ver}`;
  return `${base}.${(await hmacHex(env.SESSION_KEY, "nodo:" + base)).slice(0, 32)}`;
}
async function leerTokenNodo(env, token) {
  const m = /^n1\.([0-9a-f]{32})\.([0-9a-f]{16})\.(\d{1,9})\.([0-9a-f]{32})$/.exec(String(token || ""));
  if (!m || !env.SESSION_KEY) return null;
  const firma = (await hmacHex(env.SESSION_KEY, `nodo:n1.${m[1]}.${m[2]}.${m[3]}`)).slice(0, 32);
  return igual(firma, m[4]) ? { cuenta: m[1], nodo: m[2], ver: Number(m[3]) } : null;
}

export class RedNodos {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.pendientes = new Map(); // id → {resolve, nodo, temporizador}  (solo mientras se atiende un /pedir)
    this.ocupados = new Set(); // nodos con una pregunta en curso
    // Los «ping» del conector se contestan sin despertar al objeto (no gastan duración).
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  nodos() {
    return this.state.getWebSockets().map((ws) => ({ ws, a: ws.deserializeAttachment() || {} }));
  }

  async bloqueados() {
    return (await this.state.storage.get("bloqueados")) || {};
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/conectar") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Se esperaba un WebSocket", { status: 426 });
      if (this.state.getWebSockets().length >= MAX_NODOS) return new Response("La red está llena ahora mismo", { status: 503 });
      const [cliente, servidor] = Object.values(new WebSocketPair());
      this.state.acceptWebSocket(servidor);
      servidor.serializeAttachment({ estado: "nuevo", desde: Date.now() });
      // Quien no se presenta con un token válido a tiempo se desconecta (ver alarm()).
      const alarma = await this.state.storage.getAlarm();
      if (!alarma) await this.state.storage.setAlarm(Date.now() + ESPERA_HOLA_MS);
      return new Response(null, { status: 101, webSocket: cliente });
    }

    if (url.pathname === "/pedir" && request.method === "POST") {
      const { mensajes, maxTokens, temperatura, tiempoMs } = await request.json();
      return Response.json(await this.pedir(mensajes, maxTokens, temperatura, Math.min(Math.max(Number(tiempoMs) || 45000, 5000), 70000)));
    }

    // Resumen público: cuántos nodos activos y qué modelos (sin cuentas ni nombres).
    if (url.pathname === "/resumen") {
      const activos = this.nodos().filter((n) => n.a.estado === "activo");
      return Response.json({ activos: activos.length, modelos: [...new Set(activos.flatMap((n) => n.a.modelos || []))].slice(0, 20) });
    }

    // Panel de administración: lista detallada y bloqueo por cuenta.
    if (url.pathname === "/admin/lista") {
      const bloq = await this.bloqueados();
      return Response.json({
        nodos: this.nodos().map(({ a }) => ({
          nodo: a.nodo || null, cuenta: a.cuenta ? a.cuenta.slice(0, 8) : null, nombre: a.nombre || "", estado: a.estado,
          modelos: a.modelos || [], desde: a.desde, servidas: a.servidas || 0, fallos: a.fallos || 0, version: a.version || "",
        })),
        bloqueados: Object.entries(bloq).map(([cuenta, b]) => ({ cuenta: cuenta.slice(0, 8), desde: b.desde, motivo: b.motivo })),
      });
    }
    if (url.pathname === "/admin/bloquear" && request.method === "POST") {
      const { nodo, motivo, desbloquear } = await request.json();
      const bloq = await this.bloqueados();
      if (desbloquear) {
        // Se desbloquea por los 8 primeros caracteres de la cuenta (lo que ve el panel).
        for (const c of Object.keys(bloq)) if (c.startsWith(String(desbloquear))) delete bloq[c];
      } else {
        const objetivo = this.nodos().find((n) => n.a.nodo === nodo);
        if (!objetivo?.a.cuenta) return Response.json({ error: "Nodo no encontrado" }, { status: 404 });
        bloq[objetivo.a.cuenta] = { desde: Date.now(), motivo: limpio(motivo, 120) };
        // Se cierran todos los nodos de esa cuenta.
        for (const n of this.nodos()) if (n.a.cuenta === objetivo.a.cuenta) n.ws.close(4003, "Nodo bloqueado por la moderación de LibreIA");
      }
      await this.state.storage.put("bloqueados", bloq);
      return Response.json({ ok: true });
    }
    return new Response("no encontrado", { status: 404 });
  }

  /** Envía una pregunta al mejor nodo libre y espera su respuesta. */
  async pedir(mensajes, maxTokens, temperatura, tiempoMs) {
    const libres = this.nodos()
      .filter((n) => n.a.estado === "activo" && !this.ocupados.has(n.a.nodo))
      // Primero quien menos falla; a igualdad, quien lleva más tiempo sin responder.
      .sort((x, y) => (x.a.fallos || 0) / ((x.a.servidas || 0) + 1) - (y.a.fallos || 0) / ((y.a.servidas || 0) + 1) || (x.a.ultima || 0) - (y.a.ultima || 0));
    if (!libres.length) return { ok: false, motivo: "sin_nodos" };
    const { ws, a } = libres[0];
    const id = crypto.randomUUID();
    this.ocupados.add(a.nodo);
    const inicio = Date.now();
    const r = await new Promise((resolve) => {
      const temporizador = setTimeout(() => resolve({ ok: false, motivo: "tiempo agotado" }), tiempoMs);
      this.pendientes.set(id, { resolve, nodo: a.nodo, temporizador });
      try {
        ws.send(JSON.stringify({ tipo: "pedido", id, mensajes, max_tokens: Math.min(Number(maxTokens) || 800, 2000), temperature: temperatura }));
      } catch {
        resolve({ ok: false, motivo: "conexión cerrada" });
      }
    });
    clearTimeout(this.pendientes.get(id)?.temporizador);
    this.pendientes.delete(id);
    this.ocupados.delete(a.nodo);
    // Contadores del nodo (el socket puede haberse cerrado mientras tanto).
    try {
      const actual = ws.deserializeAttachment() || a;
      ws.serializeAttachment({ ...actual, servidas: (actual.servidas || 0) + (r.ok ? 1 : 0), fallos: (actual.fallos || 0) + (r.ok ? 0 : 1), ultima: Date.now() });
    } catch {
      /* el nodo se desconectó */
    }
    return r.ok ? { ...r, nodo: a.nombre || "anónimo", ms: Date.now() - inicio } : r;
  }

  async webSocketMessage(ws, mensaje) {
    if (typeof mensaje !== "string" || mensaje.length > MAX_MENSAJE) return ws.close(1009, "Mensaje demasiado grande");
    let m;
    try {
      m = JSON.parse(mensaje);
    } catch {
      return ws.close(1003, "JSON inválido");
    }
    const a = ws.deserializeAttachment() || {};

    if (m.tipo === "hola" && a.estado === "nuevo") {
      const t = await leerTokenNodo(this.env, m.token);
      if (!t) return ws.close(4001, "Token de nodo inválido. Genera uno nuevo en la app (Configuración).");
      if ((await this.bloqueados())[t.cuenta]) return ws.close(4003, "Esta cuenta tiene los nodos bloqueados por la moderación de LibreIA");
      if (!(await this.versionVigente(t.cuenta, t.ver))) return ws.close(4001, "El token caducó (la cuenta cerró sesión o cambió la contraseña). Genera uno nuevo.");
      // Un mismo nodo conectado dos veces: se queda la conexión nueva.
      for (const n of this.nodos()) if (n.ws !== ws && n.a.nodo === t.nodo) n.ws.close(4000, "Reemplazado por una conexión nueva del mismo nodo");
      if (this.nodos().filter((n) => n.a.cuenta === t.cuenta).length > 3) return ws.close(4002, "Máximo 3 nodos por cuenta");
      const control = CONTROLES[Math.floor(Math.random() * CONTROLES.length)];
      const idControl = "control-" + crypto.randomUUID();
      ws.serializeAttachment({
        estado: "prueba", desde: a.desde, cuenta: t.cuenta, nodo: t.nodo,
        nombre: limpio(m.nombre, 24) || "anónimo", version: limpio(m.version, 16),
        modelos: (Array.isArray(m.modelos) ? m.modelos : []).map((x) => limpio(x, 80)).filter(Boolean).slice(0, 5),
        control: { id: idControl, respuesta: control.respuesta, hasta: Date.now() + TIEMPO_CONTROL_MS }, servidas: 0, fallos: 0,
      });
      ws.send(JSON.stringify({ tipo: "pedido", id: idControl, control: true, mensajes: [{ role: "user", content: control.pregunta }], max_tokens: 400, temperature: 0 }));
      const alarma = await this.state.storage.getAlarm();
      if (!alarma || alarma > Date.now() + TIEMPO_CONTROL_MS) await this.state.storage.setAlarm(Date.now() + TIEMPO_CONTROL_MS);
      return;
    }

    if ((m.tipo === "respuesta" || m.tipo === "error") && typeof m.id === "string") {
      // Respuesta a la pregunta de control: decide si el nodo empieza a recibir tráfico.
      if (a.estado === "prueba" && m.id === a.control?.id) {
        const texto = String(m.texto || "").replace(/<think>[\s\S]*?(<\/think>|$)/g, "");
        if (m.tipo === "respuesta" && new RegExp(`(^|\\D)${a.control.respuesta}(\\D|$)`).test(texto)) {
          ws.serializeAttachment({ ...a, estado: "activo", control: undefined });
          ws.send(JSON.stringify({ tipo: "activo", mensaje: "Nodo verificado: ya recibes preguntas de la comunidad. ¡Gracias!" }));
        } else {
          ws.close(4004, "El modelo no respondió bien a la pregunta de control. Prueba con un modelo instruct más capaz.");
        }
        return;
      }
      const p = this.pendientes.get(m.id);
      if (!p || p.nodo !== a.nodo) return; // pregunta ya vencida o de otro nodo
      if (m.tipo === "error") return p.resolve({ ok: false, motivo: "el nodo falló: " + limpio(m.error, 120) });
      const texto = typeof m.texto === "string" ? m.texto.replace(/<think>[\s\S]*?(<\/think>|$)\s*/g, "").trim().slice(0, MAX_TEXTO) : "";
      if (!texto) return p.resolve({ ok: false, motivo: "respuesta vacía" });
      return p.resolve({ ok: true, texto, modelo: limpio(m.modelo, 80) || (a.modelos || [])[0] || "modelo local" });
    }
  }

  async webSocketClose(ws) {
    const a = ws.deserializeAttachment() || {};
    for (const [, p] of this.pendientes) if (p.nodo === a.nodo) p.resolve({ ok: false, motivo: "el nodo se desconectó" });
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  /** Cierra quien no se presentó a tiempo o no pasó la pregunta de control. */
  async alarm() {
    const ahora = Date.now();
    let proxima = Infinity; // el plazo pendiente más próximo
    for (const { ws, a } of this.nodos()) {
      if (a.estado === "nuevo") {
        if (ahora - a.desde >= ESPERA_HOLA_MS) ws.close(4001, "No se recibió el saludo del nodo a tiempo");
        else proxima = Math.min(proxima, a.desde + ESPERA_HOLA_MS);
      } else if (a.estado === "prueba") {
        if (ahora >= (a.control?.hasta || 0)) ws.close(4004, "El nodo no respondió a la pregunta de control a tiempo");
        else proxima = Math.min(proxima, a.control.hasta);
      }
    }
    if (proxima !== Infinity) await this.state.storage.setAlarm(proxima + 500);
  }

  /** La cuenta existe y su versión es la del token (si cerró todas las sesiones, el token caduca). */
  async versionVigente(cuenta, ver) {
    try {
      const res = await this.env.COMUNIDAD.get(this.env.COMUNIDAD.idFromName("global")).fetch("https://comunidad/cuentas/version", { method: "POST", body: JSON.stringify({ id: cuenta }) });
      const d = await res.json();
      return d.ver !== null && d.ver !== undefined && Number(d.ver) === ver;
    } catch {
      return false;
    }
  }
}
