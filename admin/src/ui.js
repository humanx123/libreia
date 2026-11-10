// Interfaz del panel de administración (se sirve desde el propio Worker).
// Sin scripts en línea: la CSP solo permite /app.js y /app.css del mismo origen.

export const HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>LibreIA · Motor</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<main id="login" class="login hidden">
  <form id="loginForm" class="card login-card" autocomplete="on">
    <h1>Libre<span>IA</span></h1>
    <p class="kicker">// Motor · panel de administración</p>
    <label>Usuario<input id="lUsuario" name="username" autocomplete="username" required></label>
    <label>Contraseña<input id="lPass" name="password" type="password" autocomplete="current-password" required></label>
    <button class="primary" type="submit">Entrar</button>
    <p id="lError" class="error" role="alert"></p>
  </form>
</main>

<div id="app" class="hidden">
  <header class="top">
    <strong>Libre<span>IA</span> <em>Motor</em></strong>
    <nav id="tabs">
      <button data-tab="estado" class="active">Estado</button>
      <button data-tab="uso">Uso</button>
      <button data-tab="comunidad">Comunidad</button>
      <button data-tab="claves">Claves</button>
      <button data-tab="motor">Motor</button>
      <button data-tab="ajustes">Ajustes</button>
      <button data-tab="registro">Registro</button>
      <button data-tab="cuenta">Cuenta</button>
    </nav>
    <button id="salir" class="ghost">Salir</button>
  </header>
  <p id="aviso" class="toast hidden" role="status"></p>

  <section id="t-estado" class="tab">
    <div class="row-head"><h2>Estado del motor</h2><button id="recargarEstado" class="ghost">Actualizar</button></div>
    <div id="estadoResumen" class="grid"></div>
    <h3>Modos</h3>
    <div id="estadoModos" class="grid"></div>
    <h3>Proveedores</h3>
    <div id="estadoProv" class="chips"></div>
  </section>

  <section id="t-uso" class="tab hidden">
    <div class="row-head"><h2>Uso de la app</h2><button id="recargarUso" class="ghost">Actualizar</button></div>
    <p class="muted">Solo números agregados y anónimos de la APK y la web: sin contenido de mensajes, sin IPs ni datos personales. Cada usuario puede desactivarlo en la app.</p>
    <h3>Usuarios</h3><div id="usoUsuarios" class="grid"></div>
    <h3>Últimos 30 días</h3><div id="usoSerie" class="card"></div>
    <h3>Mensajes</h3><div id="usoMensajes" class="grid"></div>
    <div id="usoReparto" class="grid"></div>
    <h3>Donaciones</h3><div id="usoDonaciones" class="grid"></div>
    <p id="usoNota" class="muted"></p>
  </section>

  <section id="t-comunidad" class="tab hidden">
    <div class="row-head"><h2>Propuestas de la comunidad</h2><button id="recargarProp" class="ghost">Actualizar</button></div>
    <p class="muted">Las personas usuarias proponen y votan (una cuenta, un voto). Aquí puedes marcar el estado y dar una respuesta pública. No se ve quién propuso ni quién votó.</p>
    <div id="propLista" class="list"></div>
    <div class="row-head"><h2>Red de nodos (voluntarios)</h2><button id="recargarRed" class="ghost">Actualizar</button></div>
    <p class="muted">Ordenadores de voluntarios que responden en el modo Comunidad. Solo pasan a «activo» tras responder bien una pregunta de control. Bloquear un nodo cierra todos los nodos de esa cuenta y le impide volver a conectarse. Aquí nunca se ven mensajes.</p>
    <div id="redLista" class="list"></div>
    <div class="row-head"><h2>Fuentes verificadas por los usuarios</h2><button id="recargarFuentes" class="ghost">Actualizar</button></div>
    <p class="muted">Bajo cada respuesta, las personas marcan si una fuente es real o no. Se cuentan personas distintas por dominio. Un dominio deja de usarse en la búsqueda cuando lo marcan como falso al menos el umbral de personas (Ajustes) y lo falso dobla a lo real; los confirmados salen primero. No se guardan URLs ni quién votó.</p>
    <div id="fuentesLista" class="list"></div>

  <section id="t-claves" class="tab hidden">
    <h2>Claves de proveedores</h2>
    <p class="muted">Las claves guardadas aquí se cifran (AES-256-GCM) y tienen prioridad sobre los secretos de Cloudflare. Antes de guardar, cada clave se prueba contra su proveedor: si no funciona, no se guarda.</p>
    <div id="clavesLista" class="list"></div>
  </section>

  <section id="t-motor" class="tab hidden">
    <div class="row-head"><h2>Motor: modelos y orden</h2><span id="motorOrigen" class="badge"></span></div>
    <p class="muted">Cada modo prueba los modelos en orden; si uno falla pasa al siguiente. Usa ↑ ↓ para cambiar la prioridad y «Probar» para comprobar un modelo antes de guardar.</p>
    <div id="motorModos"></div>
    <h3>Proveedores</h3>
    <div id="motorProv" class="list"></div>
    <details class="card add">
      <summary>Añadir proveedor (compatible con OpenAI)</summary>
      <div class="form-grid">
        <label>Id<input id="npId" placeholder="ej. mistral" maxlength="32"></label>
        <label>URL de chat/completions<input id="npUrl" placeholder="https://…/v1/chat/completions"></label>
        <label>Autenticación<select id="npAuth"><option value="bearer">Bearer</option><option value="x-api-key">x-api-key</option><option value="x-goog-api-key">x-goog-api-key</option><option value="none">Sin clave</option></select></label>
        <label>Nombre de la clave<input id="npSecret" placeholder="KEY_MISTRAL"></label>
      </div>
      <button id="npAdd" class="ghost">Añadir proveedor</button>
    </details>
    <div class="actions sticky">
      <button id="motorGuardar" class="primary">Guardar motor</button>
      <button id="motorRestaurar" class="ghost danger">Restaurar de fábrica</button>
    </div>
    <ul id="motorErrores" class="error"></ul>
  </section>

  <section id="t-ajustes" class="tab hidden">
    <h2>Ajustes</h2>
    <form id="ajustesForm" class="card form">
      <label>Mensajes por minuto por IP<input id="aLimite" type="number" min="1" max="600" required></label>
      <label class="check"><input id="aMant" type="checkbox"> Modo mantenimiento (la app deja de responder y muestra el mensaje)</label>
      <label>Mensaje de mantenimiento<input id="aMantMsg" maxlength="300"></label>
      <label class="check"><input id="aCuenta" type="checkbox"> Exigir cuenta para chatear (si se desactiva, también funcionan las versiones antiguas de la app)</label>
      <label class="check"><input id="aInvitados" type="checkbox"> Modo prueba: permitir chatear sin cuenta (sin Fusión, con cupo por IP)</label>
      <label class="check"><input id="aCaptcha" type="checkbox"> Captcha (Cloudflare Turnstile) al crear cuenta: frena el registro masivo con bots</label>
      <label class="check"><input id="aComunidad" type="checkbox"> Modo Comunidad (experimental): modelos de voluntarios de AI Horde (el voluntario puede ver los mensajes; la app lo avisa)</label>
      <label>Mensajes de prueba por hora y por instalación (1–100)<input id="aInvN" type="number" min="1" max="100"></label>
      <label>Máximo de mensajes al día por cuenta (10–5000; Fusión cuenta por 4)<input id="aDiaN" type="number" min="10" max="5000"></label>
      <label class="check"><input id="aWeb" type="checkbox"> Búsqueda web en las respuestas (fuentes reales citadas)</label>
      <label>Fuentes por respuesta (1–8)<input id="aWebN" type="number" min="1" max="8"></label>
      <label>Personas que deben marcar un dominio como falso para dejar de usarlo (2–50)<input id="aVetoN" type="number" min="2" max="50"></label>
      <h3>Instrucciones de sistema por modo</h3>
      <p class="muted">Vacío = la de fábrica (se muestra en gris). Definen la personalidad de cada modo.</p>
      <div id="aSistema"></div>
      <button class="primary" type="submit">Guardar ajustes</button>
    </form>
  </section>

  <section id="t-registro" class="tab hidden">
    <div class="row-head"><h2>Registro de cambios</h2><button id="recargarRegistro" class="ghost">Actualizar</button></div>
    <div id="registroLista" class="list"></div>
  </section>

  <section id="t-cuenta" class="tab hidden">
    <h2>Cuenta</h2>
    <form id="passForm" class="card form">
      <label>Contraseña actual<input id="pActual" type="password" autocomplete="current-password" required></label>
      <label>Nueva contraseña (mín. 12)<input id="pNueva" type="password" autocomplete="new-password" minlength="12" required></label>
      <label>Repite la nueva<input id="pNueva2" type="password" autocomplete="new-password" minlength="12" required></label>
      <button class="primary" type="submit">Cambiar contraseña</button>
      <p class="muted">Al cambiarla se cierran las demás sesiones abiertas.</p>
    </form>
  </section>
</div>
<script src="/app.js"></script>
</body>
</html>`;

export const CSS = `:root{color-scheme:dark;--bg:#090b10;--panel:#11151e;--panel2:#181e29;--line:#2c3443;--ink:#efe8d8;--paper:#efe8d8;--muted:#9aa2b1;--accent:#53e8d4;--red:#ff4b2b;--ok:#63d49b;--warn:#e8c18b;--bad:#ff8a73;
--display:"Anton",Impact,"Arial Narrow Bold",sans-serif;--mono:"Space Mono",ui-monospace,SFMono-Regular,monospace;--sans:"Archivo",system-ui,sans-serif}
@font-face{font-family:"Anton";src:url(/fuentes/anton.woff2) format("woff2");font-display:swap}
@font-face{font-family:"Space Mono";src:url(/fuentes/mono-400.woff2) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:"Space Mono";src:url(/fuentes/mono-700.woff2) format("woff2");font-weight:700;font-display:swap}
@font-face{font-family:"Archivo";src:url(/fuentes/archivo-400.woff2) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:"Archivo";src:url(/fuentes/archivo-700.woff2) format("woff2");font-weight:700;font-display:swap}
*{box-sizing:border-box;border-radius:0!important}
body{margin:0;color:var(--ink);font:14.5px/1.5 var(--sans);background:linear-gradient(#141923 1px,transparent 1px) 0 0/48px 48px,linear-gradient(90deg,#141923 1px,transparent 1px) 0 0/48px 48px,var(--bg)}
::selection{background:var(--accent);color:var(--bg)}:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.hidden{display:none!important}button,input,select,textarea{font:inherit;color:inherit}
.muted{color:var(--muted);font-size:12.5px}.error{color:var(--bad);font:700 12.5px var(--mono)}
.kicker{margin:0;font:700 11px var(--mono);color:var(--accent);text-transform:uppercase;letter-spacing:.08em}
.login{min-height:100dvh;display:grid;place-items:center;padding:16px}
.login-card{width:min(100%,380px);display:grid;gap:14px;border:3px solid var(--paper)!important;box-shadow:10px 10px 0 var(--accent)}
.login-card h1{font:400 58px/.9 var(--display);text-transform:uppercase}
h1,h2,h3{margin:0}h1 span,.top strong span{color:#53e8d4}
h2{font:400 30px/1 var(--display);text-transform:uppercase}
h3{margin:22px 0 10px;font:700 11px var(--mono);color:var(--accent);text-transform:uppercase;letter-spacing:.1em}
.card{background:var(--panel);border:2px solid var(--line);padding:18px}
label{display:grid;gap:6px;font:700 11px var(--mono);color:var(--accent);text-transform:uppercase;letter-spacing:.04em}
label.check{display:flex;align-items:center;gap:8px;color:var(--ink);font:400 14px/1.4 var(--sans);text-transform:none;letter-spacing:0}
input,select,textarea{width:100%;padding:10px;border:2px solid var(--line);background:var(--bg);color:var(--ink);font-family:var(--mono);font-size:13.5px}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--accent)}
textarea{min-height:90px;resize:vertical}input[type=checkbox]{width:auto;accent-color:var(--accent)}
button{cursor:pointer;padding:9px 13px;border:2px solid var(--paper);background:var(--panel);color:var(--paper);font:700 12px var(--mono);text-transform:uppercase;letter-spacing:.03em;box-shadow:3px 3px 0 var(--paper);transition:transform .1s,box-shadow .1s}
button:hover{transform:translate(-1px,-1px);box-shadow:4px 4px 0 var(--paper)}button:active{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--paper)}
.primary{background:var(--accent);color:var(--bg)}.ghost{background:transparent}.danger{background:var(--red);color:var(--bg)}
button:disabled{opacity:.5;cursor:wait}
.top{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:10px 16px;background:var(--bg);border-bottom:3px solid var(--paper)}
.top strong{font:400 28px/1 var(--display);text-transform:uppercase;white-space:nowrap}
.top strong em{font:700 11px var(--mono);font-style:normal;vertical-align:middle;margin-left:6px;padding:3px 7px;background:var(--red);color:var(--bg)}
.top nav{display:flex;gap:0;overflow-x:auto;flex:1;min-width:0;border:2px solid var(--paper)}
.top nav button{border:0;border-right:2px solid var(--line);background:transparent;color:var(--muted);white-space:nowrap;box-shadow:none;padding:9px 12px}
.top nav button:hover{transform:none;box-shadow:none;color:var(--paper)}
.top nav button.active{background:var(--accent);color:var(--bg)}
.tab{max-width:1000px;margin:0 auto;padding:20px 16px 40px}
.row-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px;padding-bottom:10px;border-bottom:3px solid var(--paper)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:0;border:2px solid var(--paper)}
.stat{background:var(--bg);border:1px solid var(--line);padding:14px;display:grid;gap:6px}
.stat b{font:400 34px/1 var(--display);color:var(--accent)}.stat small{color:var(--muted);font:700 10.5px var(--mono);text-transform:uppercase;letter-spacing:.04em}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{padding:4px 9px;border:1.5px solid var(--line);font:700 11px var(--mono);text-transform:uppercase}
.chip.ok,.badge.ok{border-color:var(--ok);color:var(--ok)}.chip.bad,.badge.bad{border-color:var(--bad);color:var(--bad)}.badge.warn{border-color:var(--warn);color:var(--warn)}
.badge{padding:3px 8px;border:1.5px solid var(--line);font:700 10.5px var(--mono);text-transform:uppercase;white-space:nowrap}
.list{display:grid;gap:10px}.item{background:var(--panel);border:2px solid var(--line);border-left:4px solid var(--accent);padding:12px;display:grid;gap:8px}
.item-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.item-head code{font:700 13px var(--mono)}
.inline{display:flex;gap:8px}.inline input{flex:1;min-width:0}
.mode{margin-bottom:16px}.mode h4{margin:0 0 8px;font:400 22px/1 var(--display);text-transform:uppercase;color:var(--accent)}
.dest{display:grid;grid-template-columns:120px minmax(0,1fr) auto;gap:6px;align-items:center;margin-bottom:6px}
.dest .btns{display:flex;gap:6px}.dest .btns button{padding:6px 8px;box-shadow:2px 2px 0 var(--paper)}
.dest .res{grid-column:1/-1;font:12px var(--mono);margin-top:-2px}
.res.ok{color:var(--ok)}.res.bad{color:var(--bad)}
.add{margin-top:14px}.add summary{cursor:pointer;color:var(--accent);font:700 12px var(--mono);text-transform:uppercase}
.form-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin:10px 0}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}.sticky{position:sticky;bottom:0;padding:12px 0;background:var(--bg);border-top:2px solid var(--line)}
.form{display:grid;gap:14px;max-width:660px}
.toast{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9;max-width:min(92vw,560px);padding:11px 15px;background:var(--panel);border:2px solid var(--paper);box-shadow:5px 5px 0 var(--accent);font:700 12.5px var(--mono)}
.toast.bad{box-shadow:5px 5px 0 var(--red);color:var(--bad)}.toast.ok{color:var(--ok)}
.bars{display:flex;align-items:flex-end;gap:3px;height:130px;padding:6px;border:2px solid var(--line);background:var(--bg)}
.bars div{flex:1;min-width:3px;background:var(--accent)}
.bars-leyenda{display:flex;justify-content:space-between;color:var(--muted);font:11px var(--mono);margin-top:6px}
.reparto{display:grid;gap:4px;font:12.5px var(--mono)}.reparto div{display:flex;justify-content:space-between;gap:8px;border-bottom:1px dashed var(--line)}
.log{display:grid;grid-template-columns:150px minmax(0,1fr);gap:8px;font-size:13px}.log time{color:var(--muted);font:11.5px var(--mono)}
@media(max-width:560px){.dest{grid-template-columns:1fr}.dest .btns{justify-content:flex-end}.log{grid-template-columns:1fr}.top nav{order:3;flex-basis:100%}.login-card h1{font-size:48px}}
@media(prefers-reduced-motion:reduce){button{transition:none}}`;

export const JS = String.raw`"use strict";
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MODOS = [["neutral", "Neutral"], ["libre", "Libre"], ["tecnico", "Técnico"], ["fusion", "Fusión"]];

async function api(ruta, opciones = {}) {
  const res = await fetch(ruta, {
    ...opciones,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(opciones.headers || {}) },
  });
  const datos = await res.json().catch(() => ({}));
  if (res.status === 401 && ruta !== "/api/login") { mostrarLogin(); throw new Error(datos.error || "Sesión caducada"); }
  if (!res.ok) { const e = new Error(datos.error || "HTTP " + res.status); e.datos = datos; throw e; }
  return datos;
}

let avisoT;
function aviso(texto, tipo = "ok") {
  const el = $("aviso");
  el.textContent = texto; el.className = "toast " + tipo;
  clearTimeout(avisoT); avisoT = setTimeout(() => el.classList.add("hidden"), tipo === "bad" ? 9000 : 4000);
}

async function ocupado(boton, fn) {
  boton.disabled = true;
  try { return await fn(); } finally { boton.disabled = false; }
}

// ------------------------------------------------------------ sesión
function mostrarLogin() { $("app").classList.add("hidden"); $("login").classList.remove("hidden"); }
function mostrarApp() { $("login").classList.add("hidden"); $("app").classList.remove("hidden"); abrir("estado"); }

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("lError").textContent = "";
  const boton = e.submitter;
  await ocupado(boton, async () => {
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify({ usuario: $("lUsuario").value.trim(), contraseña: $("lPass").value }) });
      $("lPass").value = "";
      mostrarApp();
    } catch (err) { $("lError").textContent = err.message; }
  });
});
$("salir").addEventListener("click", async () => { await api("/api/logout", { method: "POST", body: "{}" }).catch(() => {}); mostrarLogin(); });

// ------------------------------------------------------------ pestañas
let estado = null;
function abrir(tab) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("hidden", s.id !== "t-" + tab));
  ({ estado: cargarEstado, uso: cargarUso, comunidad: () => { cargarPropuestas(); cargarRed(); cargarFuentes(); }, claves: cargarClaves, motor: cargarMotor, ajustes: cargarAjustes, registro: cargarRegistro, cuenta: () => {} })[tab]();
}
$("tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-tab]"); if (b) abrir(b.dataset.tab); });

// ------------------------------------------------------------ estado
async function traerEstado() { estado = await api("/api/estado"); return estado; }

async function cargarEstado() {
  try {
    const s = await traerEstado();
    $("estadoResumen").innerHTML = [
      ["Motor", s.ok ? "En marcha" : "Con avisos", "v" + s.version, s.ok ? "ok" : "warn"],
      ["Mantenimiento", s.mantenimiento ? "ACTIVO" : "No", s.mantenimiento ? "La app no responde" : "La app responde", s.mantenimiento ? "bad" : "ok"],
      ["Catálogo", s.catalogoPersonalizado ? "Personalizado" : "De fábrica", "Editable en «Motor»", "ok"],
      ["Límite", s.ajustes.limitePorMinuto + "/min", "por IP", "ok"],
    ].map(([t, v, sub, cls]) => '<div class="stat"><small>' + esc(t) + '</small><b class="' + cls + '">' + esc(v) + "</b><small>" + esc(sub) + "</small></div>").join("")
      + (s.avisos?.length ? '<div class="stat"><small>Avisos</small><span class="error">' + s.avisos.map(esc).join("<br>") + "</span></div>" : "");
    $("estadoModos").innerHTML = MODOS.map(([id, nombre]) =>
      '<div class="stat"><small>' + nombre + '</small><b>' + (s.modos[id] ?? 0) + ' modelos</b><button data-probar-modo="' + id + '" class="ghost">Probar modo</button><span class="res" id="pm-' + id + '"></span></div>').join("");
    $("estadoProv").innerHTML = s.proveedores.map((p) => '<span class="chip ' + (p.configurado ? "ok" : "bad") + '">' + esc(p.id) + (p.configurado ? " ✓" : " sin clave") + "</span>").join("");
  } catch (e) { aviso("No se pudo leer el estado: " + e.message, "bad"); }
}
$("recargarEstado").addEventListener("click", cargarEstado);
$("estadoModos").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-probar-modo]"); if (!b) return;
  const modo = b.dataset.probarModo, out = $("pm-" + modo);
  out.className = "res"; out.textContent = "Probando…";
  await ocupado(b, async () => {
    try {
      const r = await api("/api/probar", { method: "POST", body: JSON.stringify({ modo }) });
      if (r.ok) { out.className = "res ok"; out.textContent = "✓ " + (r.ms / 1000).toFixed(1) + " s · " + r.proveedor + "/" + r.modelo + " — " + r.texto; }
      else { out.className = "res bad"; out.textContent = "✗ " + r.error + (r.intentos?.length ? " — " + r.intentos.map((i) => i.proveedor + ": " + i.error).join(" | ") : ""); }
    } catch (err) { out.className = "res bad"; out.textContent = "✗ " + err.message; }
  });
});

// ------------------------------------------------------------ uso
const num = (n) => Number(n || 0).toLocaleString("es");
const tarjeta = (t, v, sub) => '<div class="stat"><small>' + esc(t) + "</small><b>" + esc(v) + "</b><small>" + esc(sub || "") + "</small></div>";
const reparto = (titulo, obj) => {
  const filas = Object.entries(obj || {});
  return '<div class="stat"><small>' + esc(titulo) + '</small><div class="reparto">'
    + (filas.length ? filas.map(([k, v]) => "<div><span>" + esc(k) + "</span><b>" + num(v) + "</b></div>").join("") : '<span class="muted">Sin datos aún</span>') + "</div></div>";
};

async function cargarUso() {
  try {
    const u = await api("/api/uso");
    const us = u.usuarios, m = u.mensajes, ev30 = u.eventos.dias30, evT = u.eventos.total;
    $("usoUsuarios").innerHTML =
      tarjeta("Cuentas registradas", num(u.cuentas?.total), "nuevas hoy: " + num(u.cuentas?.hoy))
      + tarjeta("Instalaciones", num(us.total), "APK " + num(us.porPlataforma.android) + " · web " + num(us.porPlataforma.web))
      + tarjeta("Activos hoy", num(us.activosHoy), "nuevos hoy: " + num(us.nuevosHoy))
      + tarjeta("Activos 7 días", num(us.activos7), "nuevos: " + num(us.nuevos7))
      + tarjeta("Activos 30 días", num(us.activos30), "")
      + reparto("Versiones en uso (30 días)", us.versiones);

    const max = Math.max(1, ...u.serie.map((d) => d.mensajes));
    $("usoSerie").innerHTML = u.serie.length
      ? '<div class="bars">' + u.serie.map((d) => '<div title="' + esc(d.dia + ": " + d.mensajes + " mensajes, " + d.activos + " activos") + '" data-h="' + Math.max(2, Math.round((d.mensajes / max) * 100)) + '"></div>').join("") + "</div>"
        + '<div class="bars-leyenda"><span>' + esc(u.serie[0].dia) + "</span><span>mensajes por día (máx. " + num(max) + ")</span><span>" + esc(u.serie[u.serie.length - 1].dia) + "</span></div>"
      : '<p class="muted">Todavía no hay actividad registrada.</p>';
    // La CSP no permite atributos style en línea; la altura se pone por CSSOM.
    $("usoSerie").querySelectorAll("[data-h]").forEach((b) => (b.style.height = b.dataset.h + "%"));

    $("usoMensajes").innerHTML =
      tarjeta("Hoy", num(m.hoy)) + tarjeta("7 días", num(m.dias7)) + tarjeta("30 días", num(m.dias30)) + tarjeta("Total", num(m.total))
      + tarjeta("Fallos (30 días)", num(m.fallos30), m.dias30 ? ((m.fallos30 / m.dias30) * 100).toFixed(1) + " % de los mensajes" : "");
    $("usoReparto").innerHTML = reparto("Por modo (30 días)", m.porModo30) + reparto("Por proveedor (30 días)", m.porProveedor30) + reparto("Por plataforma (30 días)", m.porPlataforma30) + reparto("Búsqueda web (30 días)", m.web30) + reparto("Cuenta o modo prueba (30 días)", { "con cuenta": Math.max((m.dias30 || 0) - (m.invitado30 || 0), 0), "modo prueba": m.invitado30 || 0 });

    const c = u.cadena || {};
    const ev = (k) => num(ev30[k]) + " (total " + num(evT[k]) + ")";
    $("usoDonaciones").innerHTML =
      tarjeta("Abrieron «Apoyar»", num(ev30.donar_abierto), "30 días · total " + num(evT.donar_abierto))
      + reparto("Direcciones copiadas (30 días)", { USDC: ev30["copiar:usdc"] || 0, BTC: ev30["copiar:btc"] || 0, XMR: ev30["copiar:xmr"] || 0 })
      + reparto("Abrieron la billetera (30 días)", { USDC: ev30["billetera:usdc"] || 0, BTC: ev30["billetera:btc"] || 0, XMR: ev30["billetera:xmr"] || 0 })
      + (c.btc ? tarjeta("BTC recibido (cadena)", c.btc.recibido + " BTC", num(c.btc.donaciones) + " pagos" + (c.btc.pendientes ? " · " + c.btc.pendientes + " pendientes" : "")) : "")
      + (c.usdc ? tarjeta("USDC recibido (Arbitrum)", c.usdc.recibido.toFixed(2) + " USDC", num(c.usdc.donaciones) + " pagos desde " + c.usdc.desde + " · saldo " + c.usdc.saldo.toFixed(2)) : "")
      + tarjeta("Monero recibido", "No verificable", "Monero es privado: solo tu billetera lo ve");
    $("usoNota").innerHTML = "Las cifras de la cadena se actualizan cada 10 min. "
      + "<b>Aviso:</b> las direcciones de donación son las mismas que las de Kumo, así que lo recibido incluye ambos proyectos."
      + (c.errores?.length ? '<br><span class="error">' + c.errores.map(esc).join("<br>") + "</span>" : "");
  } catch (e) { aviso("No se pudo leer el uso: " + e.message, "bad"); }
}
$("recargarUso").addEventListener("click", cargarUso);

// ------------------------------------------------------------ comunidad
const ESTADOS_P = [["abierta", "Abierta"], ["en_curso", "En curso"], ["hecha", "Hecha"], ["descartada", "Descartada"]];
async function cargarPropuestas() {
  try {
    const { propuestas } = await api("/api/propuestas");
    $("propLista").innerHTML = propuestas.map((p) =>
      '<div class="item" data-prop="' + p.id + '"><div class="item-head"><b>' + esc(p.titulo) + '</b><span class="badge ok">' + num(p.votos) + " votos</span><span class=\"muted\">#" + p.id + " · " + esc(p.creada) + "</span></div>"
      + (p.texto ? '<p class="muted">' + esc(p.texto) + "</p>" : "")
      + '<div class="inline"><select data-campo="estado">' + ESTADOS_P.map(([v, t]) => '<option value="' + v + '"' + (p.estado === v ? " selected" : "") + ">" + t + "</option>").join("") + "</select>"
      + '<input data-campo="respuesta" maxlength="500" placeholder="Respuesta pública (opcional)" value="' + esc(p.respuesta || "") + '"></div>'
      + '<div class="inline"><button class="primary" data-prop-guardar>Guardar</button><button class="ghost danger" data-prop-borrar>Borrar (spam)</button></div></div>').join("")
      || '<p class="muted">Todavía no hay propuestas.</p>';
  } catch (e) { aviso("No se pudieron leer las propuestas: " + e.message, "bad"); }
}
$("recargarProp").addEventListener("click", cargarPropuestas);

async function cargarRed() {
  try {
    const { nodos, bloqueados, aviso: av } = await api("/api/red");
    const fecha = (t) => (t ? new Date(t).toLocaleString() : "—");
    $("redLista").innerHTML = (av ? '<p class="muted">' + esc(av) + "</p>" : "")
      + (nodos.map((n) =>
        '<div class="item" data-nodo="' + esc(n.nodo || "") + '"><div class="item-head"><b>' + esc(n.nombre || "anónimo") + '</b><span class="badge ' + (n.estado === "activo" ? "ok" : "warn") + '">' + esc(n.estado) + "</span>"
        + '<span class="muted">cuenta ' + esc(n.cuenta || "?") + "… · desde " + esc(fecha(n.desde)) + " · v" + esc(n.version || "?") + "</span></div>"
        + '<p class="muted">Modelos: ' + esc((n.modelos || []).join(", ") || "—") + " · respondidas " + num(n.servidas) + " · fallos " + num(n.fallos) + "</p>"
        + (n.nodo ? '<div class="inline"><input data-motivo maxlength="120" placeholder="Motivo del bloqueo (opcional)"><button class="ghost danger" data-bloquear>Bloquear</button></div>' : "")
        + "</div>").join("") || '<p class="muted">No hay nodos conectados ahora.</p>')
      + (bloqueados.length ? "<h3>Cuentas bloqueadas</h3>" + bloqueados.map((b) => '<div class="item"><div class="item-head"><b>cuenta ' + esc(b.cuenta) + '…</b><span class="muted">' + esc(fecha(b.desde)) + (b.motivo ? " · " + esc(b.motivo) : "") + '</span><button class="ghost" data-desbloquear="' + esc(b.cuenta) + '">Desbloquear</button></div></div>').join("") : "");
  } catch (e) { aviso("No se pudo leer la red de nodos: " + e.message, "bad"); }
}
$("recargarRed").addEventListener("click", cargarRed);
async function cargarFuentes() {
  try {
    const [{ dominios, votos, aviso: av }, est] = await Promise.all([api("/api/fuentes"), traerEstado().catch(() => ({}))]);
    const umbral = est?.ajustes?.fuentesVetoMin || 3;
    const filas = Object.entries(dominios || {}).sort((a, b) => b[1].falsa - a[1].falsa || b[1].real - a[1].real);
    $("fuentesLista").innerHTML = (av ? '<p class="muted">' + esc(av) + "</p>" : "")
      + '<p class="muted">' + num(votos) + " verificaciones · umbral " + num(umbral) + "</p>"
      + (filas.map(([d, r]) => {
        const vetado = r.falsa >= umbral && r.falsa > 2 * r.real;
        const estado = vetado ? '<span class="badge bad">no se usa</span>' : r.real > r.falsa ? '<span class="badge ok">confirmada</span>' : '<span class="badge warn">en revisión</span>';
        return '<div class="item"><div class="item-head"><b>' + esc(d) + "</b>" + estado + '<span class="muted">✓ real ' + num(r.real) + " · ✗ falsa " + num(r.falsa) + "</span></div></div>";
      }).join("") || '<p class="muted">Todavía nadie verificó fuentes.</p>');
  } catch (e) { aviso("No se pudo leer la verificación de fuentes: " + e.message, "bad"); }
}
$("recargarFuentes").addEventListener("click", cargarFuentes);
$("redLista").addEventListener("click", async (e) => {
  const des = e.target.closest("[data-desbloquear]");
  if (des) {
    await ocupado(des, async () => {
      try { await api("/api/red/bloquear", { method: "POST", body: JSON.stringify({ desbloquear: des.dataset.desbloquear }) }); aviso("✓ Cuenta desbloqueada"); cargarRed(); }
      catch (err) { aviso(err.message, "bad"); }
    });
    return;
  }
  const item = e.target.closest("[data-nodo]");
  if (!item || !e.target.closest("[data-bloquear]")) return;
  if (!confirm("¿Bloquear este nodo y todos los de su cuenta?")) return;
  await ocupado(e.target, async () => {
    try { await api("/api/red/bloquear", { method: "POST", body: JSON.stringify({ nodo: item.dataset.nodo, motivo: item.querySelector("[data-motivo]").value }) }); aviso("✓ Nodo bloqueado"); cargarRed(); }
    catch (err) { aviso(err.message, "bad"); }
  });
});
$("propLista").addEventListener("click", async (e) => {
  const item = e.target.closest("[data-prop]"); if (!item) return;
  const id = +item.dataset.prop;
  if (e.target.closest("[data-prop-guardar]")) {
    await ocupado(e.target, async () => {
      try {
        await api("/api/propuestas/estado", { method: "POST", body: JSON.stringify({ propuesta: id, estado: item.querySelector('[data-campo="estado"]').value, respuesta: item.querySelector('[data-campo="respuesta"]').value }) });
        aviso("✓ Propuesta actualizada"); cargarPropuestas();
      } catch (err) { aviso(err.message, "bad"); }
    });
  }
  if (e.target.closest("[data-prop-borrar]")) {
    if (!confirm("¿Borrar la propuesta #" + id + " y sus votos?")) return;
    try { await api("/api/propuestas/borrar", { method: "POST", body: JSON.stringify({ propuesta: id }) }); aviso("Propuesta borrada"); cargarPropuestas(); }
    catch (err) { aviso(err.message, "bad"); }
  }
});

// ------------------------------------------------------------ claves
const ORIGEN = { panel: ["Panel (cifrada)", "ok"], secreto: ["Secreto de Cloudflare", "warn"], ninguna: ["Falta", "bad"] };
async function cargarClaves() {
  try {
    const s = await traerEstado();
    $("clavesLista").innerHTML = s.claves.map((c) => {
      const [txt, cls] = ORIGEN[c.origen] || [c.origen, ""];
      return '<div class="item"><div class="item-head"><code>' + esc(c.nombre) + '</code><span class="badge ' + cls + '">' + esc(txt) + "</span>"
        + (c.final ? '<span class="muted">termina en ' + esc(c.final) + "</span>" : "")
        + '<span class="muted">· ' + esc(c.proveedores.join(", ")) + '</span></div>'
        + '<div class="inline"><input type="password" autocomplete="off" placeholder="Pega la nueva clave" data-clave-input="' + esc(c.nombre) + '">'
        + '<button class="primary" data-clave-guardar="' + esc(c.nombre) + '">Probar y guardar</button>'
        + (c.origen === "panel" ? '<button class="ghost danger" data-clave-quitar="' + esc(c.nombre) + '">Quitar</button>' : "")
        + "</div></div>";
    }).join("") || '<p class="muted">No hay proveedores con clave en el catálogo.</p>';
  } catch (e) { aviso("No se pudieron leer las claves: " + e.message, "bad"); }
}
$("clavesLista").addEventListener("click", async (e) => {
  const g = e.target.closest("[data-clave-guardar]"), q = e.target.closest("[data-clave-quitar]");
  if (g) {
    const nombre = g.dataset.claveGuardar;
    const input = document.querySelector('[data-clave-input="' + nombre + '"]');
    if (!input.value.trim()) return aviso("Pega primero la clave", "bad");
    await ocupado(g, async () => {
      try {
        const r = await api("/api/claves/" + nombre, { method: "PUT", body: JSON.stringify({ valor: input.value }) });
        input.value = "";
        aviso("✓ " + nombre + " funciona (" + r.prueba.modelo + ", " + r.prueba.ms + " ms) y quedó guardada");
        cargarClaves();
      } catch (err) { aviso(err.message, "bad"); }
    });
  }
  if (q) {
    const nombre = q.dataset.claveQuitar;
    if (!confirm("¿Quitar " + nombre + " del panel? Si existe un secreto de Cloudflare con ese nombre, se volverá a usar.")) return;
    await ocupado(q, async () => {
      try { await api("/api/claves/" + nombre, { method: "DELETE", body: "{}" }); aviso(nombre + " quitada"); cargarClaves(); }
      catch (err) { aviso(err.message, "bad"); }
    });
  }
});

// ------------------------------------------------------------ motor (catálogo)
let cat = null;
const LISTAS = [["neutral", "Neutral"], ["libre", "Libre"], ["tecnico", "Técnico"], ["fusion.panel", "Fusión · panel (responden a la vez)"], ["fusion.panelFallback", "Fusión · respaldo del panel"], ["fusion.synth", "Fusión · sintetizador"]];
const leerLista = (clave) => clave === "fusion.synth" ? [cat.fusion.synth] : clave.startsWith("fusion.") ? (cat.fusion[clave.slice(7)] ||= []) : cat.modes[clave];

async function cargarMotor() {
  try {
    const r = await api("/api/catalogo");
    cat = JSON.parse(JSON.stringify(r.catalogo));
    $("motorOrigen").textContent = r.personalizado ? "Personalizado" : "De fábrica";
    $("motorOrigen").className = "badge " + (r.personalizado ? "warn" : "ok");
    $("motorErrores").innerHTML = "";
    pintarMotor();
  } catch (e) { aviso("No se pudo leer el motor: " + e.message, "bad"); }
}

function opcionesProv(sel) {
  return Object.keys(cat.providers).map((id) => '<option value="' + esc(id) + '"' + (id === sel ? " selected" : "") + ">" + esc(id) + "</option>").join("");
}

function pintarMotor() {
  $("motorModos").innerHTML = LISTAS.map(([clave, nombre]) => {
    const lista = leerLista(clave);
    const unico = clave === "fusion.synth";
    return '<div class="mode card"><h4>' + esc(nombre) + "</h4>" + lista.map((d, i) =>
      '<div class="dest" data-lista="' + clave + '" data-i="' + i + '">'
      + '<select data-campo="platform">' + opcionesProv(d.platform) + "</select>"
      + '<input data-campo="model" value="' + esc(d.model) + '" placeholder="id del modelo">'
      + '<div class="btns">' + (unico ? "" : '<button data-acc="arriba" title="Subir">↑</button><button data-acc="abajo" title="Bajar">↓</button><button data-acc="quitar" title="Quitar">✕</button>')
      + '<button data-acc="probar">Probar</button></div><span class="res"></span></div>').join("")
      + (unico ? "" : '<button class="ghost" data-anadir="' + clave + '">+ Añadir modelo</button>') + "</div>";
  }).join("");

  const usados = new Set([...Object.values(cat.modes).flat(), ...cat.fusion.panel, ...(cat.fusion.panelFallback || []), cat.fusion.synth].map((d) => d.platform));
  $("motorProv").innerHTML = Object.entries(cat.providers).map(([id, p]) =>
    '<div class="item" data-prov="' + esc(id) + '"><div class="item-head"><code>' + esc(id) + "</code>"
    + (p.secretName ? '<span class="badge">' + esc(p.secretName) + "</span>" : '<span class="badge">sin clave</span>')
    + (usados.has(id) ? "" : '<button class="ghost danger" data-prov-quitar="' + esc(id) + '">Quitar</button>') + "</div>"
    + '<input data-prov-url value="' + esc(p.url) + '"></div>').join("");
}

$("motorModos").addEventListener("change", (e) => {
  const fila = e.target.closest(".dest"); if (!fila) return;
  const d = leerLista(fila.dataset.lista)[+fila.dataset.i];
  d[e.target.dataset.campo] = e.target.value.trim();
});
$("motorModos").addEventListener("click", async (e) => {
  const anadir = e.target.closest("[data-anadir]");
  if (anadir) { leerLista(anadir.dataset.anadir).push({ platform: Object.keys(cat.providers)[0], model: "" }); return pintarMotor(); }
  const b = e.target.closest("[data-acc]"); if (!b) return;
  const fila = b.closest(".dest"), lista = leerLista(fila.dataset.lista), i = +fila.dataset.i;
  if (b.dataset.acc === "arriba" && i > 0) { [lista[i - 1], lista[i]] = [lista[i], lista[i - 1]]; pintarMotor(); }
  else if (b.dataset.acc === "abajo" && i < lista.length - 1) { [lista[i + 1], lista[i]] = [lista[i], lista[i + 1]]; pintarMotor(); }
  else if (b.dataset.acc === "quitar") { lista.splice(i, 1); pintarMotor(); }
  else if (b.dataset.acc === "probar") {
    const out = fila.querySelector(".res"), d = lista[i];
    out.className = "res"; out.textContent = "Probando…";
    await ocupado(b, async () => {
      try {
        const r = await api("/api/probar", { method: "POST", body: JSON.stringify({ platform: d.platform, model: d.model }) });
        out.className = "res " + (r.ok ? "ok" : "bad");
        out.textContent = r.ok ? "✓ " + r.ms + " ms — " + r.texto : "✗ " + r.error + (r.error === "proveedor desconocido" ? " (guarda el motor primero si el proveedor es nuevo)" : "");
      } catch (err) { out.className = "res bad"; out.textContent = "✗ " + err.message; }
    });
  }
});
$("motorProv").addEventListener("change", (e) => {
  const item = e.target.closest("[data-prov]"); if (item && e.target.matches("[data-prov-url]")) cat.providers[item.dataset.prov].url = e.target.value.trim();
});
$("motorProv").addEventListener("click", (e) => {
  const q = e.target.closest("[data-prov-quitar]"); if (!q) return;
  delete cat.providers[q.dataset.provQuitar]; pintarMotor();
});
$("npAuth").addEventListener("change", () => { $("npSecret").disabled = $("npAuth").value === "none"; });
$("npAdd").addEventListener("click", () => {
  const id = $("npId").value.trim().toLowerCase(), auth = $("npAuth").value;
  const secretName = auth === "none" ? null : ($("npSecret").value.trim().toUpperCase() || "KEY_" + id.toUpperCase().replace(/[^A-Z0-9]/g, "_"));
  if (!/^[a-z0-9_-]{1,32}$/.test(id)) return aviso("Id inválido: minúsculas, números, - o _", "bad");
  if (cat.providers[id]) return aviso("Ya existe un proveedor con ese id", "bad");
  cat.providers[id] = { url: $("npUrl").value.trim(), auth, secretName, extraHeaders: {} };
  ["npId", "npUrl", "npSecret"].forEach((x) => ($(x).value = ""));
  pintarMotor(); aviso("Proveedor añadido. Guarda el motor y luego pon su clave en «Claves».");
});
$("motorGuardar").addEventListener("click", (e) => ocupado(e.target, async () => {
  $("motorErrores").innerHTML = "";
  try {
    try { await api("/api/catalogo", { method: "PUT", body: JSON.stringify({ catalogo: cat }) }); }
    catch (err) {
      if (!err.datos?.requiereContraseña) throw err;
      const contraseña = prompt(err.message + "\n\nEscribe tu contraseña para confirmar:");
      if (!contraseña) throw new Error("Cambio cancelado: no se guardó el motor");
      await api("/api/catalogo", { method: "PUT", body: JSON.stringify({ catalogo: cat, contraseña }) });
    }
    aviso("✓ Motor guardado. La app lo usa en menos de 30 s."); cargarMotor();
  }
  catch (err) {
    aviso(err.message, "bad");
    $("motorErrores").innerHTML = (err.datos?.errores || []).map((x) => "<li>" + esc(x) + "</li>").join("");
  }
}));
$("motorRestaurar").addEventListener("click", (e) => {
  if (!confirm("¿Restaurar el motor de fábrica? Se pierden los cambios del catálogo (las claves se conservan).")) return;
  ocupado(e.target, async () => {
    try { await api("/api/catalogo", { method: "DELETE", body: "{}" }); aviso("Motor restaurado"); cargarMotor(); }
    catch (err) { aviso(err.message, "bad"); }
  });
});

// ------------------------------------------------------------ ajustes
async function cargarAjustes() {
  try {
    const s = await traerEstado(), a = s.ajustes;
    $("aLimite").value = a.limitePorMinuto; $("aMant").checked = !!a.mantenimiento; $("aMantMsg").value = a.mensajeMantenimiento || "";
    $("aWeb").checked = a.busquedaWeb !== false; $("aCuenta").checked = a.requerirCuenta !== false; $("aWebN").value = a.resultadosWeb || 5; $("aVetoN").value = a.fuentesVetoMin || 3;
    $("aInvitados").checked = a.invitados !== false; $("aCaptcha").checked = a.captchaRegistro !== false; $("aComunidad").checked = a.modoComunidad !== false; $("aInvN").value = a.mensajesInvitado || 10; $("aDiaN").value = a.mensajesDiaCuenta || 300;
    $("aSistema").innerHTML = MODOS.map(([id, nombre]) =>
      '<label>' + nombre + '<textarea data-sistema="' + id + '" maxlength="4000" placeholder="' + esc(s.sistemaPorDefecto[id]) + '">' + esc(a.sistema?.[id] || "") + "</textarea></label>").join("");
  } catch (e) { aviso("No se pudieron leer los ajustes: " + e.message, "bad"); }
}
$("ajustesForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const sistema = {}; document.querySelectorAll("[data-sistema]").forEach((t) => (sistema[t.dataset.sistema] = t.value));
  if ($("aMant").checked && !confirm("El modo mantenimiento detiene la app para todos los usuarios. ¿Activarlo?")) return;
  ocupado(e.submitter, async () => {
    try {
      await api("/api/ajustes", { method: "PUT", body: JSON.stringify({ limitePorMinuto: +$("aLimite").value, mantenimiento: $("aMant").checked, mensajeMantenimiento: $("aMantMsg").value, sistema, busquedaWeb: $("aWeb").checked, requerirCuenta: $("aCuenta").checked, invitados: $("aInvitados").checked, captchaRegistro: $("aCaptcha").checked, modoComunidad: $("aComunidad").checked, mensajesInvitado: +$("aInvN").value, mensajesDiaCuenta: +$("aDiaN").value, resultadosWeb: +$("aWebN").value, fuentesVetoMin: +$("aVetoN").value }) });
      aviso("✓ Ajustes guardados. La app los usa en menos de 30 s.");
    } catch (err) { aviso(err.message, "bad"); }
  });
});

// ------------------------------------------------------------ registro
async function cargarRegistro() {
  try {
    const { registro } = await api("/api/registro");
    $("registroLista").innerHTML = registro.map((r) => '<div class="item log"><time>' + esc(new Date(r.t).toLocaleString("es")) + "</time><span>" + esc(r.accion) + ' <span class="muted">· ' + esc(r.usuario) + " · " + esc(r.ip) + "</span></span></div>").join("") || '<p class="muted">Sin cambios todavía.</p>';
  } catch (e) { aviso("No se pudo leer el registro: " + e.message, "bad"); }
}
$("recargarRegistro").addEventListener("click", cargarRegistro);

// ------------------------------------------------------------ cuenta
$("passForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if ($("pNueva").value !== $("pNueva2").value) return aviso("Las contraseñas nuevas no coinciden", "bad");
  ocupado(e.submitter, async () => {
    try {
      await api("/api/contrasena", { method: "POST", body: JSON.stringify({ actual: $("pActual").value, nueva: $("pNueva").value }) });
      e.target.reset(); aviso("✓ Contraseña cambiada");
    } catch (err) { aviso(err.message, "bad"); }
  });
});

// ------------------------------------------------------------ inicio
api("/api/sesion").then(mostrarApp).catch(mostrarLogin);
`;
