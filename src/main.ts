// LibreIA Chat — APK (Capacitor) y web.
import "./style.css";
import "./tema.css";
import "./pieles.css";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { api, ApiError, sendEvent, session, prefs, deriveCredentials, normalizeEmail, IS_NATIVE, GUEST_NS } from "./api";
import { OWN_PROVIDERS, loadOwnKey, saveOwnKey, updateOwnKey, clearOwnKey, ownKeyForRequest, keyHint } from "./propia";
import { ABOUT_HTML, PRIVACY_POINTS, RECOVERY_WARNING, NODE_SCRIPT_URL } from "./contenido";

type Role = "user" | "assistant";
type Verdict = "real" | "falsa";
type Source = { n: number; titulo: string; url: string; dominio: string; voto?: Verdict };
type Meta = { modo: string; proveedor?: string; modelo?: string };
type Message = { role: Role; content: string; error?: boolean; cta?: boolean; fuentes?: Source[]; meta?: Meta };
type ChatSession = { id: string; title: string; updatedAt: number; messages: Message[] };
type View = "chat" | "about" | "community";

// Skins: same brutalist DNA (square corners, firm borders, hard shadows), different temperament.
// Each one has a night (default) and a day version; see pieles.css.
const SKINS = [
  { id: "pancarta", nombre: "Pancarta", lema: "La de siempre: cartel de protesta, cian y tinta." },
  { id: "ateneo", nombre: "Ateneo", lema: "Humanidades: serif de biblioteca, granate y oro viejo." },
  { id: "laboratorio", nombre: "Laboratorio", lema: "Ciencia: papel milimetrado, cobalto y tipografía técnica." },
] as const;
type Skin = (typeof SKINS)[number]["id"];
type Look = { piel: Skin; modo: "oscuro" | "claro" };

const MODES = [
  { id: "neutral", label: "Neutral" },
  { id: "libre", label: "Libre" },
  { id: "tecnico", label: "Técnico" },
  { id: "fusion", label: "Fusión" },
  { id: "comunidad", label: "Comunidad 🧪" },
];
// Community mode: an open model running on a volunteer's computer (AI Horde). The volunteer can read
// the messages, so it is only used after the person accepts this notice.
const COMMUNITY_NOTICE =
  "Modo Comunidad (experimental)\n\n" +
  "Responde un modelo abierto que corre en el ordenador de un voluntario de la red AI Horde: IA hecha por personas, sin empresas.\n\n" +
  "• Es más lento (de 10 s a 1 min) y los modelos son más pequeños.\n" +
  "• IMPORTANTE: el voluntario que ejecuta el modelo PUEDE VER tu mensaje. No escribas datos personales en este modo.\n\n" +
  "¿Activarlo?";
let communityOn = true; // the server can switch the mode off (see /transparencia)

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
// Element lookup that ignores anything inside a chat message: rendered replies can never stand in
// for an app control (a donation address, the prompt box, a password field…).
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  // parentElement: the #messages container itself is an app element (it has the .messages class).
  const injected = (x: Element) => !!x.parentElement?.closest(".messages");
  if (!el || !injected(el)) return el as T;
  return [...document.querySelectorAll<HTMLElement>("#" + CSS.escape(id))].find((x) => !injected(x)) as T;
};
const safeUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : "#");
const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Old settings that users must no longer see or change.
["libreia.backend", "libreia.backendToken"].forEach((k) => localStorage.removeItem(k));

// ---------------------------------------------------------------- state
let chats: ChatSession[] = [];
let chatId = "";
let messages: Message[] = [];
let model = localStorage.getItem("libreia.model") || "neutral";
if (!MODES.some((m) => m.id === model)) model = "neutral";
let sending = false;
let pendingChatId: string | null = null;
let pendingModel = ""; // mode of the message being answered (the waiting text depends on it)
let stopReply: (() => void) | null = null; // cancels the request in flight (Stop button)
let view: View = "chat";

// Chats are stored per account on this device (shared devices keep them apart).
const chatsKey = () => `libreia.chats.${session.ns}`;
// ---------------------------------------------------------------- stored data validation
// Everything read from storage or from an imported file is rebuilt field by field: a malformed or
// hostile file can neither break the app at startup nor inject HTML.
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
function cleanSources(v: unknown): Source[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter((f) => f && typeof f === "object" && Number.isInteger(f.n) && f.n >= 1 && f.n <= 99 && typeof f.url === "string" && /^https?:\/\//i.test(f.url))
    .slice(0, 20)
    .map((f) => ({ n: f.n, url: str(f.url, 2000), titulo: str(f.titulo, 200) || str(f.url, 80), dominio: str(f.dominio, 120), ...(f.voto === "real" || f.voto === "falsa" ? { voto: f.voto as Verdict } : {}) }));
  return out.length ? out : undefined;
}
function cleanMeta(v: any): Meta | undefined {
  if (!v || typeof v !== "object" || typeof v.modo !== "string") return undefined;
  return { modo: str(v.modo, 20), proveedor: str(v.proveedor, 40) || undefined, modelo: str(v.modelo, 120) || undefined };
}
function cleanChats(v: unknown): ChatSession[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((c) => c && typeof c === "object" && typeof c.id === "string" && c.id.length <= 80 && Array.isArray(c.messages))
    .map((c) => ({
      id: c.id,
      title: str(c.title, 80) || "Chat",
      updatedAt: Number.isFinite(Number(c.updatedAt)) ? Number(c.updatedAt) : Date.now(),
      messages: c.messages
        .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map((m: any) => ({
          role: m.role,
          content: m.content.slice(0, 200000),
          ...(m.error ? { error: true } : {}),
          ...(m.cta ? { cta: true } : {}),
          ...(cleanSources(m.fuentes) ? { fuentes: cleanSources(m.fuentes) } : {}),
          ...(cleanMeta(m.meta) ? { meta: cleanMeta(m.meta) } : {}),
        })),
    }));
}
const readJson = (key: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
};

function loadChats() {
  chats = cleanChats(readJson(chatsKey()));
  // Chats from before accounts existed go to the first account that signs in on this device.
  const legacy = localStorage.getItem("libreia.chats");
  if (legacy) {
    try {
      const old = cleanChats(JSON.parse(legacy));
      chats = [...old.filter((o) => o.messages.length && !chats.some((c) => c.id === o.id)), ...chats];
    } catch {
      /* ignore broken legacy data */
    }
    localStorage.removeItem("libreia.chats");
  }
  chatId = localStorage.getItem(`${chatsKey()}.active`) || "";
  if (!chats.some((c) => c.id === chatId)) newChat(false);
  messages = chats.find((c) => c.id === chatId)!.messages;
  saveChats();
}
let storageWarned = false;
/** Saves the chats; returns false (and warns once) if the device storage is full. */
function saveChats(): boolean {
  if (!session.ns) return true;
  try {
    localStorage.setItem(chatsKey(), JSON.stringify(chats));
    localStorage.setItem(`${chatsKey()}.active`, chatId);
    storageWarned = false;
    return true;
  } catch {
    if (!storageWarned) {
      storageWarned = true;
      alert("El almacenamiento de este dispositivo está lleno: los últimos mensajes no se pudieron guardar.\n\nVe a Configuración → Exportar y luego borra chats antiguos.");
    }
    return false;
  }
}
// Another tab changed the chats: reload them instead of overwriting them later.
window.addEventListener("storage", (e) => {
  if (e.key === chatsKey() && !sending && session.active) {
    loadChats();
    renderChatList();
    renderMessages();
  }
});
function newChat(render = true) {
  const empty = chats.find((c) => !c.messages.length);
  if (empty) chatId = empty.id;
  else {
    chatId = makeId();
    chats.unshift({ id: chatId, title: "Nuevo chat", updatedAt: Date.now(), messages: [] });
  }
  messages = chats.find((c) => c.id === chatId)!.messages;
  if (render) {
    saveChats();
    renderChatList();
    renderMessages();
    showView("chat");
    closeSidebarOnMobile();
    $("prompt").focus();
  }
}

// ---------------------------------------------------------------- markdown
marked.setOptions({ gfm: true, breaks: true });
// Only presentational markup: no forms, inputs, styles, ids or data attributes in AI replies.
const PURIFY = {
  ALLOWED_TAGS: ["p", "br", "hr", "strong", "b", "em", "i", "del", "s", "code", "pre", "blockquote", "ul", "ol", "li", "a",
    "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tr", "th", "td", "sup", "sub", "span"],
  ALLOWED_ATTR: ["href", "title", "start", "align", "class"],
  ALLOW_DATA_ATTR: false,
  SANITIZE_NAMED_PROPS: true,
};
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  const cls = node.getAttribute("class");
  if (cls && !/^language-[\w+-]{1,30}$/.test(cls)) node.removeAttribute("class");
  if (node.tagName === "A") {
    const href = node.getAttribute("href") || "";
    if (!/^https?:\/\//i.test(href)) node.removeAttribute("href");
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer nofollow");
    if (/^\[\d+\]$/.test(node.textContent || "")) node.setAttribute("class", "cita");
  }
});
function renderMarkdown(text: string, fuentes?: Source[]): string {
  // Some models cite as 【1】 or 【1†L3-L5】: normalise to [1].
  const src = text.replace(/【(\d{1,2})(?:†[^】]*)?】/g, "[$1]");
  const clean = DOMPurify.sanitize(marked.parse(src, { async: false }) as string, PURIFY) as unknown as string;
  if (!fuentes?.length) return clean;
  // Citations become links AFTER sanitizing, only in plain text (never inside code or existing links).
  const byN = new Map(fuentes.map((f) => [f.n, f]));
  const tpl = document.createElement("template");
  tpl.innerHTML = clean;
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const t = walker.currentNode as Text;
    if (/\[\d{1,2}\]/.test(t.data) && !t.parentElement?.closest("pre, code, a")) nodes.push(t);
  }
  for (const t of nodes) {
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of t.data.matchAll(/\[(\d{1,2})\]/g)) {
      const f = byN.get(Number(m[1]));
      if (!f) continue;
      frag.append(t.data.slice(last, m.index));
      const a = document.createElement("a");
      a.href = safeUrl(f.url);
      a.className = "cita";
      a.target = "_blank";
      a.rel = "noopener noreferrer nofollow";
      a.textContent = `[${m[1]}]`;
      frag.append(a);
      last = m.index! + m[0].length;
    }
    frag.append(t.data.slice(last));
    t.replaceWith(frag);
  }
  return tpl.innerHTML;
}
/** Each source can be marked real or not by the user; the votes improve the web search for everyone. */
function verdictButtons(f: Source): string {
  const b = (v: Verdict, label: string, title: string) =>
    `<button type="button" class="verif-btn ${v}" data-verif="${v}" data-src="${Number(f.n) | 0}" aria-pressed="${f.voto === v}" title="${title}">${label}</button>`;
  return `<div class="verif" role="group" aria-label="¿Es real esta fuente?"><span class="verif-q">¿Es real?</span>${b("real", "✓ Sí", "La fuente existe y dice lo que se cita")}${b("falsa", "✗ No", "La fuente no existe, no funciona o no dice lo que se cita")}<span class="verif-msg" aria-live="polite"></span></div>`;
}
function renderSources(fuentes?: Source[]): string {
  if (!fuentes?.length) return "";
  return `<div class="sources"><div class="sources-title">Fuentes consultadas <span class="sources-hint">· márcalas: ¿son reales?</span></div><ol>${fuentes
    .map((f) => `<li value="${Number(f.n) | 0}" class="${f.voto ? "voto-" + f.voto : ""}"><a href="${esc(safeUrl(f.url))}" target="_blank" rel="noopener noreferrer nofollow">${esc(f.titulo)}</a><span class="dominio">${esc(f.dominio)}</span>${verdictButtons(f)}</li>`)
    .join("")}</ol></div>`;
}
const modeLabel = (id: string) => MODES.find((m) => m.id === id)?.label || id;

// ---------------------------------------------------------------- layout
document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
<section id="authView" class="auth-view hidden">
  <div class="auth-card">
    <div class="auth-brand"><div><h1>Libre<b>IA</b></h1><p>// La IA es un bien común</p></div></div>
    <div class="auth-tabs" role="tablist">
      <button type="button" data-auth-tab="registro" class="active">Crear cuenta</button>
      <button type="button" data-auth-tab="entrar">Entrar</button>
    </div>
    <form id="authForm" class="auth-form" autocomplete="on">
      <label>Correo (solo como nombre de usuario)<input id="authEmail" type="email" autocomplete="username" required maxlength="200"></label>
      <label>Contraseña<input id="authPass" type="password" autocomplete="new-password" required minlength="10" maxlength="200"></label>
      <label id="authPass2Row">Repite la contraseña<input id="authPass2" type="password" autocomplete="new-password" minlength="10" maxlength="200"></label>
      <div id="authWarn">${RECOVERY_WARNING}
        <label class="check-row"><input id="authAck" type="checkbox"> Guardé mi contraseña en un lugar seguro y entiendo que no se puede recuperar.</label>
        <div id="authCaptcha" class="captcha-box hidden" aria-label="Verificación: no soy un robot"></div>
      </div>
      <button id="authSubmit" class="primary big" type="submit">Crear cuenta</button>
      <p id="authError" class="error-text" role="alert"></p>
    </form>
    <div id="guestBox" class="guest-box">
      <div class="or-line"><span>o</span></div>
      <button type="button" id="guestBtn" class="guest-btn">⚡ Probar sin registrarme</button>
      <p id="guestNote" class="muted small">Sin correo ni contraseña: unos mensajes por hora, sin Fusión ni votos. Tus chats quedan solo en este dispositivo.</p>
    </div>
    <details class="privacy-details" open>
      <summary>🔒 Qué guardamos (y qué no)</summary>
      ${PRIVACY_POINTS}
    </details>
    <button type="button" class="link-btn" data-go="about">¿Qué es LibreIA? Leer el manifiesto</button>
  </div>
</section>

<main id="shell" class="app-shell hidden">
  <div id="backdrop" class="backdrop"></div>
  <aside class="sidebar" id="sidebar" aria-label="Menú">
    <div class="sidebar-head">
      <div class="brand"><strong>LIBRE<b>IA</b></strong></div>
      <button id="hideSidebar" class="hide-btn" type="button" title="Ocultar el menú">⟨ Ocultar</button>
    </div>
    <button id="newChat" class="new-chat" type="button">＋ Nuevo chat</button>
    <div class="side-label">Tus chats · solo en este dispositivo</div>
    <div id="chatList" class="chat-list"></div>
    <nav class="side-links">
      <button type="button" data-go="about">❓ ¿Qué es LibreIA?</button>
      <button type="button" data-go="community">🗳 Comunidad: propón y vota</button>
      <button type="button" data-open-support>♥ Apoyar</button>
      <button type="button" data-open-settings>⚙ Configuración y mis datos</button>
    </nav>
    <div class="sidebar-foot">
      <span id="connectionDot" class="dot offline"></span>
      <span id="connectionStatus">Conectando…</span>
    </div>
  </aside>

  <section class="workspace">
    <header class="topbar">
      <button id="toggleSidebar" class="menu-btn" type="button" aria-controls="sidebar" title="Mostrar u ocultar el menú">☰ <span>Menú</span></button>
      <h1 id="viewTitle">LibreIA</h1>
      <select id="modelPicker" class="model-picker" title="Modo de respuesta">${MODES.map((m) => `<option value="${m.id}">${m.label}</option>`).join("")}</select>
      <button class="icon-btn" type="button" data-open-support title="Apoyar LibreIA">♥</button>
      <button id="modeToggle" class="icon-btn mode-toggle" type="button" title="Cambiar a modo día" aria-label="Cambiar a modo día">
        <svg class="luna" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></svg>
        <svg class="sol" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3M4.8 4.8l2.1 2.1M17.1 17.1l2.1 2.1M4.8 19.2l2.1-2.1M17.1 6.9l2.1-2.1"/></svg>
      </button>
      <button class="icon-btn" type="button" data-open-settings title="Configuración">⚙</button>
    </header>

    <div id="chatView" class="chat-view">
      <div id="messages" class="messages"></div>
      <div id="ownBar" class="guest-bar own-bar hidden">
        <span>🔑 <b>Tu clave</b> · <span id="ownBarText">no gasta el cupo común</span></span>
        <button type="button" data-open-settings>Cambiar</button>
      </div>
      <div id="guestBar" class="guest-bar hidden">
        <span>🧪 <b>Modo prueba</b> · <span id="guestQuota">cupo limitado por hora</span> · sin Fusión</span>
        <button type="button" data-auth="registro">Crear cuenta gratis</button>
      </div>
      <form id="composer" class="composer">
        <textarea id="prompt" placeholder="Escribe tu pregunta…" rows="1"></textarea>
        <button id="send" class="send-btn" type="submit" title="Enviar" aria-label="Enviar">➤</button>
      </form>
    </div>
    <div id="aboutView" class="page hidden"></div>
    <div id="communityView" class="page hidden"></div>
  </section>
</main>

<dialog id="settingsDialog">
  <div class="dialog-card">
    <div class="dialog-title"><h2>Configuración y mis datos</h2><button class="icon-btn" type="button" data-close-dialog>✕</button></div>

    <h3>Apariencia</h3>
    <div class="pieles" role="radiogroup" aria-label="Piel de la app">${SKINS.map((k) => `<button type="button" class="piel" role="radio" data-piel="${k.id}" aria-checked="false"><span class="muestra" aria-hidden="true"><b>Aa</b><i></i></span><span class="nombre">${k.nombre}</span><span class="lema">${k.lema}</span></button>`).join("")}</div>
    <div class="modo-row" role="radiogroup" aria-label="Modo"><button type="button" role="radio" data-modo="oscuro" aria-checked="true">☾ Noche</button><button type="button" role="radio" data-modo="claro" aria-checked="false">☀ Día</button></div>

    <h3>Preferencias</h3>
    <label class="check-row"><input id="webInput" type="checkbox"> Búsqueda web con fuentes reales</label>
    <label class="check-row"><input id="statsInput" type="checkbox"> Contar mi uso de forma anónima (solo números, nunca contenido)</label>

    <h3>Tu propia clave de IA (opcional)</h3>
    <p class="muted">¿Tienes una clave de Groq, Google AI Studio, OpenRouter u otro proveedor? Úsala aquí y tus mensajes no gastarán el cupo común, que queda para quien no tiene. Tampoco cuentan para tu tope diario ni para el cupo de prueba.</p>
    <p class="muted small">🔒 Se guarda <b>cifrada solo en este dispositivo</b>. Pasa por el servidor de LibreIA únicamente para reenviar cada mensaje a tu proveedor, y no se guarda allí (el código es abierto). Es solo tuya: no se comparte con nadie. Al cerrar sesión se borra de este dispositivo.</p>
    <form id="ownKeyForm" class="stack own-key">
      <label>Proveedor<select id="ownProv">${Object.entries(OWN_PROVIDERS).map(([id, p]) => `<option value="${id}">${p.nombre} — ${p.nota}</option>`).join("")}</select></label>
      <p class="muted small" id="ownHelp"></p>
      <label>Clave<input id="ownKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="400" placeholder="Pega aquí tu clave"></label>
      <label>Modelo<span class="own-model"><input id="ownModel" list="ownModels" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="160" placeholder="Nombre del modelo"><button type="button" id="ownList">Ver modelos</button></span></label>
      <datalist id="ownModels"></datalist>
      <label class="check-row"><input id="ownOn" type="checkbox" checked> Usar mi clave en mis chats</label>
      <div class="btn-row"><button class="primary" type="submit">Guardar y probar</button><button type="button" id="ownRemove" class="hidden">Quitar mi clave</button></div>
      <p id="ownStatus" class="status-text" role="status"></p>
    </form>

    <h3>Mis chats</h3>
    <p class="muted">Tus chats solo existen en este dispositivo. Haz copias tú mismo/a: nadie más las tiene.</p>
    <div class="btn-row">
      <button type="button" id="exportJson">⬇ Exportar (JSON)</button>
      <button type="button" id="exportMd">⬇ Exportar (Markdown)</button>
      <button type="button" id="importBtn">⬆ Importar</button>
      <input id="importFile" type="file" accept="application/json,.json" hidden>
    </div>
    <button type="button" id="wipeChats" class="danger-btn">Borrar todos mis chats de este dispositivo</button>

    <div id="guestSection" class="hidden">
      <h3>Modo prueba</h3>
      <p class="muted">Estás probando LibreIA sin cuenta. Con una cuenta gratis tienes más mensajes, el modo Fusión y puedes proponer y votar. Tus chats de prueba pasan a tu cuenta en este dispositivo.</p>
      <div class="btn-row"><button type="button" class="primary" data-auth="registro">Crear cuenta gratis</button><button type="button" data-auth="entrar">Ya tengo cuenta</button></div>
      <button type="button" id="exitGuest">Salir del modo prueba</button>
    </div>
    <div id="accountSection">
    <h3>Presta tu ordenador (nodo LibreIA)</h3>
    <p class="muted">¿Tienes un modelo local (Ollama, LM Studio, llama.cpp o KoboldCpp)? Conéctalo a la red y responderá a quien use el modo <b>Comunidad</b>. El conector abre una conexión de salida: no hay que abrir puertos.</p>
    <details class="node-guide">
      <summary>Cómo conectar mi nodo</summary>
      <ol class="muted small">
        <li>Instala <a href="https://nodejs.org" target="_blank" rel="noopener noreferrer" data-external>Node.js 22 o superior</a> y un servidor local con un modelo <i>instruct</i>. Por ejemplo, <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" data-external>Ollama</a> con <code>ollama pull qwen3:4b</code>.</li>
        <li>Descarga el conector: <a href="${NODE_SCRIPT_URL}" target="_blank" rel="noopener noreferrer" data-external>libreia-nodo.mjs</a> (código abierto, léelo si quieres).</li>
        <li>Genera tu token y ejecuta el comando que aparece abajo. Antes de recibir preguntas, tu nodo responderá una de control.</li>
      </ol>
      <p class="muted small">⚠️ Tu nodo verá las preguntas que responde. El conector no las guarda ni las muestra; trátalas con respeto. Si un nodo responde mal o abusa, la moderación puede bloquearlo.</p>
      <button type="button" id="nodeTokenBtn">Generar mi token de nodo</button>
      <div id="nodeTokenBox" class="hidden">
        <pre class="node-cmd"><code id="nodeCmd"></code></pre>
        <div class="btn-row"><button type="button" id="nodeCopy">Copiar comando</button></div>
        <p class="muted small">El token deja de valer si cierras sesión en todos tus dispositivos o cambias la contraseña. Máximo 3 nodos por cuenta.</p>
      </div>
      <p id="nodeStatus" class="status-text" role="status"></p>
    </details>

    <h3>Mi cuenta</h3>
    <p class="muted">Sesión: <b id="accountEmail"></b> (el correo solo se guarda en este dispositivo).</p>
    <button type="button" id="logoutBtn">Cerrar sesión</button>
    <details>
      <summary>Cambiar contraseña</summary>
      <form id="passForm" class="stack">
        <input id="passOld" type="password" placeholder="Contraseña actual" autocomplete="current-password" required>
        <input id="passNew" type="password" placeholder="Nueva contraseña (mín. 10)" autocomplete="new-password" minlength="10" required>
        <input id="passNew2" type="password" placeholder="Repite la nueva" autocomplete="new-password" minlength="10" required>
        <button class="primary" type="submit">Cambiar contraseña</button>
      </form>
    </details>
    <details>
      <summary class="danger-text">Borrar mi cuenta</summary>
      <form id="deleteForm" class="stack">
        <p class="muted">Se borra la huella de tu cuenta y tus votos. Tus propuestas quedan para la comunidad, sin autor. Tus chats siguen en este dispositivo hasta que los borres.</p>
        <input id="deletePass" type="password" placeholder="Tu contraseña para confirmar" autocomplete="current-password" required>
        <button class="danger-btn" type="submit">Borrar mi cuenta para siempre</button>
      </form>
    </details>
    </div>
    <p id="settingsStatus" class="status-text" role="status"></p>
  </div>
</dialog>

<dialog id="supportDialog">
  <div class="dialog-card">
    <div class="dialog-title"><h2>♥ Apoyar LibreIA</h2><button class="icon-btn" type="button" data-close-dialog>✕</button></div>
    <p class="muted">LibreIA es gratis y lo seguirá siendo. Una donación <b>voluntaria</b> ayuda a pagar el servidor y modelos mejores para todos. Envía cada moneda <b>solo por su propia red</b>.</p>
    <div class="don">
      <div class="don-card"><div class="don-head"><img src="/donar/usdc.svg" alt=""><b>USDC · red Arbitrum</b></div>
        <img class="qr" src="/donar/qr-usdc.svg" alt="Código QR de la dirección USDC en Arbitrum">
        <code class="dir" id="dirUsdc">0xAC43f9b0E7F0ae6386cfC8ef6BFf62CE9c3006A1</code>
        <p class="muted don-note">Solo <b>USDC en Arbitrum</b>, mínimo <b>5 USDC</b>. No envíes por Ethereum, BNB ni otra red: se pierde.</p>
        <div class="don-actions"><button type="button" data-copy="dirUsdc">Copiar</button><button type="button" class="primary" data-wallet="ethereum:0xaf88d065e77c8cC2239327C5EDb3A432268e5831@42161/transfer?address=0xAC43f9b0E7F0ae6386cfC8ef6BFf62CE9c3006A1">Abrir billetera</button></div></div>
      <div class="don-card"><div class="don-head"><img src="/donar/bitcoin.svg" alt=""><b>Bitcoin (BTC)</b></div>
        <img class="qr" src="/donar/qr-bitcoin.svg" alt="Código QR de la dirección Bitcoin">
        <code class="dir" id="dirBtc">bc1qd9j45f4t0jwyhjhqh2kvz2cr7k8xye460rr2y7</code>
        <div class="don-actions"><button type="button" data-copy="dirBtc">Copiar</button><button type="button" class="primary" data-wallet="bitcoin:bc1qd9j45f4t0jwyhjhqh2kvz2cr7k8xye460rr2y7">Abrir billetera</button></div></div>
      <div class="don-card"><div class="don-head"><img src="/donar/monero.svg" alt=""><b>Monero (XMR)</b></div>
        <img class="qr" src="/donar/qr-monero.svg" alt="Código QR de la dirección Monero">
        <code class="dir" id="dirXmr">447gTj6Hg6gaAEAUmjqfhqDZr1PziUTvbT4LYLpmLVnTNVFK6cqeqPfh6P4neMKLWX5jDXAr94fWHacJwDvjmCzBBH8wPBt</code>
        <div class="don-actions"><button type="button" data-copy="dirXmr">Copiar</button><button type="button" class="primary" data-wallet="monero:447gTj6Hg6gaAEAUmjqfhqDZr1PziUTvbT4LYLpmLVnTNVFK6cqeqPfh6P4neMKLWX5jDXAr94fWHacJwDvjmCzBBH8wPBt">Abrir billetera</button></div></div>
    </div>
    <div class="don-other">
      <b>¿Prefieres donar por otro medio?</b>
      <p>Escríbenos a <a href="mailto:libreia@proton.me?subject=Donaci%C3%B3n%20a%20LibreIA">libreia@proton.me</a> y vemos juntos la mejor forma.</p>
    </div>
    <p id="donStatus" class="status-text" role="status"></p>
    <p class="muted don-thanks">¡Gracias! 🙏<br><i>Hecho xhumanx + IA</i></p>
  </div>
</dialog>`;

const messagesEl = $<HTMLDivElement>("messages");
const shell = $("shell");
const settingsDialog = $<HTMLDialogElement>("settingsDialog");
const supportDialog = $<HTMLDialogElement>("supportDialog");

// ---------------------------------------------------------------- sidebar (explicit show / hide)
const isDesktop = () => window.matchMedia("(min-width: 800px)").matches;
function setSidebar(open: boolean) {
  if (isDesktop()) {
    shell.classList.toggle("collapsed", !open);
    localStorage.setItem("libreia.menuOculto", open ? "no" : "si");
  } else {
    shell.classList.toggle("sidebar-open", open);
  }
  const label = $("toggleSidebar").querySelector("span")!;
  label.textContent = open && !isDesktop() ? "Cerrar" : "Menú";
}
const sidebarIsOpen = () => (isDesktop() ? !shell.classList.contains("collapsed") : shell.classList.contains("sidebar-open"));
function closeSidebarOnMobile() {
  if (!isDesktop()) setSidebar(false);
}
$("toggleSidebar").addEventListener("click", () => setSidebar(!sidebarIsOpen()));
$("hideSidebar").addEventListener("click", () => setSidebar(false));
$("backdrop").addEventListener("click", () => setSidebar(false));
if (localStorage.getItem("libreia.menuOculto") === "si") shell.classList.add("collapsed");
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !isDesktop() && sidebarIsOpen()) setSidebar(false);
});

// ---------------------------------------------------------------- views
function showView(v: View) {
  view = v;
  const loggedIn = session.active;
  // The "about" page is also reachable before signing in.
  if (!loggedIn && v !== "about") {
    $("guestBtn").textContent = "⚡ Probar sin registrarme";
    $("authView").classList.remove("hidden");
    shell.classList.add("hidden");
    return;
  }
  $("authView").classList.add("hidden");
  shell.classList.remove("hidden");
  $("chatView").classList.toggle("hidden", v !== "chat");
  $("aboutView").classList.toggle("hidden", v !== "about");
  $("communityView").classList.toggle("hidden", v !== "community");
  $("modelPicker").classList.toggle("hidden", v !== "chat");
  if (v === "about") $("viewTitle").textContent = "¿Qué es LibreIA?";
  else if (v === "community") $("viewTitle").textContent = "Comunidad";
  else $("viewTitle").innerHTML = "Libre<b>IA</b>";
  shell.classList.toggle("no-session", !loggedIn);
  applyGuestUi();
  if (v === "about") renderAbout();
  if (v === "community") renderCommunity();
  closeSidebarOnMobile();
}

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  // In the APK, external links (repo, email) go to the system browser / mail app.
  const ext = t.closest<HTMLAnchorElement>("a[href^='mailto:'], a[data-external]");
  if (ext && IS_NATIVE && /^(https?|mailto):/i.test(ext.href)) {
    e.preventDefault();
    window.location.href = ext.href;
    return;
  }
  const toAuth = t.closest<HTMLElement>("[data-auth]");
  if (toAuth) {
    goToAuth(toAuth.dataset.auth === "entrar" ? "entrar" : "registro");
    return;
  }
  const go = t.closest<HTMLElement>("[data-go]");
  if (go) {
    showView(go.dataset.go as View);
    return;
  }
  if (t.closest("[data-back]")) {
    showView("chat");
    return;
  }
  if (t.closest("[data-open-support]")) {
    supportDialog.showModal();
    sendEvent("donar_abierto");
    return;
  }
  if (t.closest("[data-open-settings]")) {
    openSettings();
    return;
  }
  if (t.closest("[data-close-dialog]")) {
    t.closest("dialog")?.close();
    return;
  }
  if (t.closest("[data-share]")) {
    share();
  }
});
[settingsDialog, supportDialog].forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));

async function share() {
  const url = "https://libreia.pages.dev";
  const text = "LibreIA: inteligencia artificial libre, neutral y de la comunidad. Gratis y sin guardar tus datos.";
  try {
    if (navigator.share) await navigator.share({ title: "LibreIA", text, url });
    else {
      await copyText(`${text} ${url}`);
      alert("Enlace copiado: " + url);
    }
  } catch {
    /* user cancelled */
  }
}

// ---------------------------------------------------------------- auth
let authMode: "registro" | "entrar" = "registro";
function setAuthMode(m: "registro" | "entrar") {
  authMode = m;
  document.querySelectorAll<HTMLButtonElement>("[data-auth-tab]").forEach((b) => b.classList.toggle("active", b.dataset.authTab === m));
  $("authPass2Row").classList.toggle("hidden", m !== "registro");
  $("authWarn").classList.toggle("hidden", m !== "registro");
  $("authSubmit").textContent = m === "registro" ? "Crear cuenta" : "Entrar";
  $<HTMLInputElement>("authPass").autocomplete = m === "registro" ? "new-password" : "current-password";
  $("authError").textContent = "";
  if (m === "registro") void showCaptcha();
}

// Registration captcha (Cloudflare Turnstile). The site key comes from /transparencia; null = disabled.
// The script is only loaded when someone opens "Crear cuenta", never for sign-in or chat.
let captchaKey: string | null = null;
let captchaToken = "";
let captchaWidget: string | null = null;
let turnstileLoad: Promise<void> | null = null;
type Turnstile = {
  render: (el: HTMLElement, o: Record<string, unknown>) => string;
  reset: (id: string) => void;
};
const turnstile = () => (window as unknown as { turnstile?: Turnstile }).turnstile;
function loadTurnstile(): Promise<void> {
  turnstileLoad ??= new Promise<void>((resolve, reject) => {
    const sc = document.createElement("script");
    sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    sc.async = true;
    sc.onload = () => resolve();
    sc.onerror = () => {
      turnstileLoad = null; // allow a retry
      reject(new Error("No se pudo cargar la verificación «no soy un robot». Revisa tu conexión."));
    };
    document.head.appendChild(sc);
  });
  return turnstileLoad;
}
async function showCaptcha() {
  const box = $("authCaptcha");
  if (!captchaKey) return void box.classList.add("hidden");
  box.classList.remove("hidden");
  if (captchaWidget) return;
  try {
    await loadTurnstile();
    const ts = turnstile();
    if (!ts || captchaWidget) return;
    captchaWidget = ts.render(box, {
      sitekey: captchaKey,
      theme: document.documentElement.dataset.modo === "claro" ? "light" : "dark", // follows the day/night toggle
      language: "es",
      callback: (t: string) => {
        captchaToken = t;
        $("authError").textContent = "";
      },
      "expired-callback": () => (captchaToken = ""),
      "error-callback": () => {
        captchaToken = "";
        $("authError").textContent = "La verificación «no soy un robot» falló. Se reintentará sola; si sigue, recarga.";
      },
    });
  } catch (ex) {
    $("authError").textContent = (ex as Error).message;
  }
}
/** A Turnstile token is single use: after every attempt a fresh one is needed. */
function resetCaptcha() {
  captchaToken = "";
  if (captchaWidget) turnstile()?.reset(captchaWidget);
}
document.querySelectorAll<HTMLButtonElement>("[data-auth-tab]").forEach((b) => b.addEventListener("click", () => setAuthMode(b.dataset.authTab as any)));

$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = normalizeEmail($<HTMLInputElement>("authEmail").value);
  const pass = $<HTMLInputElement>("authPass").value;
  const err = $("authError");
  err.textContent = "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return void (err.textContent = "Escribe un correo válido (solo se usa como nombre de usuario).");
  if (pass.length < 10) return void (err.textContent = "La contraseña debe tener al menos 10 caracteres.");
  if (authMode === "registro") {
    if (pass !== $<HTMLInputElement>("authPass2").value) return void (err.textContent = "Las contraseñas no coinciden.");
    if (!$<HTMLInputElement>("authAck").checked) return void (err.textContent = "Confirma que guardaste tu contraseña: no se puede recuperar.");
  }
  if (authMode === "registro" && captchaKey && !captchaToken) {
    void showCaptcha();
    return void (err.textContent = "Completa la verificación «no soy un robot».");
  }
  const btn = $<HTMLButtonElement>("authSubmit");
  btn.disabled = true;
  btn.textContent = "Protegiendo tus datos en este dispositivo…";
  const registering = authMode === "registro";
  try {
    const cred = await deriveCredentials(email, pass);
    // Registering only needs the strong key; signing in also sends the old one so a pre-0.10
    // account is upgraded on the spot (the server ignores it once the account is upgraded).
    const body = registering ? { correoHash: cred.correoHash, kdf: cred.kdf, clave: cred.clave, captcha: captchaToken || undefined } : cred;
    const r = await api<{ sesion: string }>(registering ? "/cuenta/registro" : "/cuenta/entrar", { body, auth: "app", timeoutMs: 20000 });
    const ns = cred.correoHash.slice(0, 16);
    if (session.guest) adoptGuestChats(ns);
    session.save(r.sesion, email, ns);
    $<HTMLInputElement>("authPass").value = "";
    $<HTMLInputElement>("authPass2").value = "";
    startApp();
  } catch (ex) {
    err.textContent = (ex as Error).message;
    // The server requires a captcha this client did not know about yet (just turned on: the public
    // info can be cached for minutes), so the error itself carries the site key to show it now.
    if (ex instanceof ApiError && ex.code === "captcha" && !captchaKey) {
      const key = ex.data.captcha;
      if (typeof key === "string" && /^[\w-]{10,100}$/.test(key)) captchaKey = key;
      else await loadTrialInfo();
    }
  } finally {
    btn.disabled = false;
    if (registering) resetCaptcha();
    const msg = err.textContent;
    setAuthMode(authMode);
    err.textContent = msg;
  }
});

// ---------------------------------------------------------------- trial mode (no account)
let guestQuota: number | null = null;
function startGuest() {
  session.startGuest();
  sendEvent("prueba_iniciada");
  startApp();
}
$("guestBtn").addEventListener("click", () => (session.guest ? showView("chat") : startGuest()));
$("exitGuest").addEventListener("click", () => {
  if (confirm("¿Salir del modo prueba? Tus chats de prueba se quedan en este dispositivo.")) logout();
});
/** Shows the sign-up / sign-in screen; a guest can go back to trying it out. */
function goToAuth(mode: "registro" | "entrar") {
  settingsDialog.close();
  setAuthMode(mode);
  $("authView").classList.remove("hidden");
  shell.classList.add("hidden");
  $("guestBtn").textContent = session.guest ? "← Seguir probando sin cuenta" : "⚡ Probar sin registrarme";
  $("authView").scrollTop = 0;
  $<HTMLInputElement>("authEmail").focus();
}
/** Trial chats move into the account the guest creates or signs into (on this device only). */
function adoptGuestChats(ns: string) {
  const from = `libreia.chats.${GUEST_NS}`;
  try {
    const guestChats = cleanChats(readJson(from)).filter((c) => c.messages.length);
    const mine = cleanChats(readJson(`libreia.chats.${ns}`));
    if (guestChats.length) localStorage.setItem(`libreia.chats.${ns}`, JSON.stringify([...guestChats.filter((g) => !mine.some((m) => m.id === g.id)), ...mine]));
    localStorage.removeItem(from);
    localStorage.removeItem(`${from}.active`);
  } catch {
    /* broken trial data: leave it where it is */
  }
}
let ownActive = false; // the user's own key is saved and switched on
function applyGuestUi() {
  const guest = session.guest;
  // With an own key the trial quota does not apply, so its bar gives way to the own-key bar.
  $("guestBar").classList.toggle("hidden", !guest || ownActive || view !== "chat");
  $("ownBar").classList.toggle("hidden", !ownActive || view !== "chat");
  const pick = $<HTMLSelectElement>("modelPicker");
  const fusion = pick.querySelector<HTMLOptionElement>("option[value=fusion]")!;
  const community = pick.querySelector<HTMLOptionElement>("option[value=comunidad]")!;
  community.hidden = community.disabled = !communityOn;
  if (!communityOn && model === "comunidad") {
    model = "neutral";
    pick.value = model;
  }
  // Fusion combines several LibreIA models, so it needs an account and does not use an own key.
  fusion.disabled = guest || ownActive;
  fusion.textContent = guest ? "Fusión (con cuenta)" : ownActive ? "Fusión (sin tu clave)" : "Fusión";
  if (fusion.disabled && model === "fusion") {
    model = "neutral";
    pick.value = model;
  }
  if (guestQuota) $("guestQuota").textContent = `${guestQuota} mensajes por hora`;
}
/** Reads the public trial quota (also tells whether trial mode is enabled at all). */
async function loadTrialInfo(): Promise<boolean> {
  try {
    const t = await api("/transparencia", { auth: "app" });
    communityOn = t?.comunidad?.activa !== false;
    const key = t?.registro?.captcha;
    captchaKey = typeof key === "string" && /^[\w-]{10,100}$/.test(key) ? key : null;
    if (authMode === "registro" && !$("authView").classList.contains("hidden")) void showCaptcha();
    const p = t?.prueba;
    if (p && p.activa === false) {
      $("guestBox").classList.add("hidden");
      return false;
    }
    guestQuota = Number(p?.mensajesPorHora) || null;
    if (guestQuota) $("guestNote").textContent = `Sin correo ni contraseña: hasta ${guestQuota} mensajes por hora, sin Fusión ni votos. Tus chats quedan solo en este dispositivo.`;
    applyGuestUi();
    return true;
  } catch {
    return true; // the button stays; the server answers with the real limit if needed
  }
}

function logout() {
  // Closing the session also invalidates the token on the server (in case it was copied).
  if (session.token) api("/cuenta/salir", { body: {}, timeoutMs: 8000 }).catch(() => {});
  session.clear();
  // The own provider key belongs to whoever saved it: it does not stay for the next person.
  clearOwnKey();
  ownActive = false;
  chats = [];
  messages = [];
  settingsDialog.close();
  setAuthMode("entrar");
  showView("chat");
}

// ---------------------------------------------------------------- chat rendering
function renderMessages() {
  if (!messages.length) {
    messagesEl.innerHTML = `<div class="welcome"><div class="welcome-mark" aria-hidden="true">LIBRE<b>IA</b></div><p class="welcome-kicker">// IA libre · neutral · de la comunidad</p><h2>¿En qué te <span>ayudo</span>?</h2>
      <p>Pregunta lo que quieras. LibreIA busca en la web y cita sus fuentes.</p>
      <div class="suggestions">
        <button type="button" data-suggest="Explícame las distintas posturas sobre la renta básica universal">Posturas sobre la renta básica</button>
        <button type="button" data-suggest="¿Qué noticias importantes hay hoy sobre inteligencia artificial?">Noticias de IA de hoy</button>
        <button type="button" data-suggest="Escribe una función en Python que valide un correo electrónico">Código en Python</button>
      </div></div>`;
    return;
  }
  messagesEl.innerHTML =
    messages
      .map((m, i) => {
        let body: string;
        try {
          body =
            m.role === "user" || m.error
              ? esc(m.content).replace(/\n/g, "<br>")
              : renderMarkdown(m.content, m.fuentes) + renderSources(m.fuentes);
        } catch {
          body = esc(m.content).replace(/\n/g, "<br>"); // a broken message never breaks the whole chat
        }
        const meta = m.meta && m.role === "assistant" && !m.error
          ? `<div class="msg-meta">${esc(modeLabel(m.meta.modo))}${m.meta.proveedor ? ` · respondió ${esc(m.meta.proveedor)}${m.meta.modelo ? ` / ${esc(m.meta.modelo)}` : ""}` : ""}</div>`
          : "";
        const cta = m.cta && session.guest ? `<div class="cta-row"><button type="button" class="primary" data-auth="registro">Crear cuenta gratis</button><button type="button" data-auth="entrar">Ya tengo cuenta</button></div>` : "";
        return `<div class="message ${m.role}${m.error ? " error" : ""}${m.cta ? " trial" : ""}" data-i="${i}"><div class="avatar">${m.role === "user" ? "TÚ" : "LI"}</div><div class="message-body">${body}${cta}${meta}</div></div>`;
      })
      .join("") +
    (pendingChatId === chatId ? `<div class="thinking"><i></i>${pendingModel === "comunidad" ? "Esperando a un voluntario de la comunidad…" : prefs.web ? "Buscando fuentes y pensando…" : "Pensando…"}<button type="button" class="stop-inline" data-stop title="Detener la respuesta">■ Detener</button></div>` : "");
  messagesEl.querySelectorAll(".message.assistant pre").forEach((pre) => {
    const b = document.createElement("button");
    b.className = "copy-code";
    b.type = "button";
    b.textContent = "Copiar";
    pre.appendChild(b);
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderChatList() {
  $("chatList").innerHTML =
    [...chats]
      .filter((c) => c.messages.length || c.id === chatId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(
        (c) => `<div class="chat-item ${c.id === chatId ? "active" : ""}">
          <button class="chat-open" type="button" data-chat="${esc(c.id)}"><span>${esc(c.title || "Nuevo chat")}</span><small>${new Date(c.updatedAt).toLocaleDateString()}</small></button>
          <button class="chat-delete" type="button" data-delete-chat="${esc(c.id)}" title="Borrar este chat">🗑</button>
        </div>`,
      )
      .join("") || `<p class="muted small">Sin chats todavía.</p>`;
}
$("chatList").addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const del = t.closest<HTMLElement>("[data-delete-chat]");
  if (del) {
    if (!confirm("¿Borrar este chat? No se puede deshacer.")) return;
    const id = del.dataset.deleteChat!;
    chats = chats.filter((c) => c.id !== id);
    if (id === chatId) {
      chatId = "";
      newChat(false);
    }
    saveChats();
    renderChatList();
    renderMessages();
    return;
  }
  const open = t.closest<HTMLElement>("[data-chat]");
  if (open) {
    chatId = open.dataset.chat!;
    messages = chats.find((c) => c.id === chatId)!.messages;
    saveChats();
    renderChatList();
    renderMessages();
    showView("chat");
  }
});
$("newChat").addEventListener("click", () => newChat());

messagesEl.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t.closest("[data-stop]")) {
    stopReply?.();
    return;
  }
  const verif = t.closest<HTMLButtonElement>("[data-verif]");
  if (verif) {
    void verifySource(verif);
    return;
  }
  const sug = t.closest<HTMLElement>("[data-suggest]");
  if (sug) {
    $<HTMLTextAreaElement>("prompt").value = sug.dataset.suggest!;
    $<HTMLFormElement>("composer").requestSubmit();
    return;
  }
  const copyBtn = t.closest<HTMLButtonElement>(".copy-code");
  if (copyBtn) {
    copyText(copyBtn.parentElement?.querySelector("code")?.textContent ?? "").then(
      () => { copyBtn.textContent = "Copiado ✓"; setTimeout(() => (copyBtn.textContent = "Copiar"), 1500); },
      () => { copyBtn.textContent = "No se pudo copiar"; },
    );
    return;
  }
  const link = t.closest<HTMLAnchorElement>("a[href]");
  if (link && IS_NATIVE && /^(https?|mailto):/i.test(link.href)) {
    // In the APK, navigating to an external URL makes Capacitor open the system browser.
    e.preventDefault();
    window.location.href = link.href;
  }
});

// ---------------------------------------------------------------- source verification
/** Marks a source real / not real (clicking the same choice again removes the mark). Saved locally and sent to the server. */
async function verifySource(btn: HTMLButtonElement) {
  const li = btn.closest("li")!;
  const i = Number(btn.closest<HTMLElement>(".message")?.dataset.i);
  const f = messages[i]?.fuentes?.find((x) => x.n === Number(btn.dataset.src));
  if (!f) return;
  const before = f.voto;
  const choice = btn.dataset.verif as Verdict;
  const voto: Verdict | undefined = before === choice ? undefined : choice;
  const msg = li.querySelector<HTMLElement>(".verif-msg")!;
  const paint = (v: Verdict | undefined) => {
    li.className = v ? "voto-" + v : "";
    li.querySelectorAll<HTMLButtonElement>("[data-verif]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.verif === v)));
  };
  const store = (v: Verdict | undefined) => {
    if (v) f.voto = v;
    else delete f.voto;
    saveChats();
    paint(v);
  };
  store(voto);
  msg.className = "verif-msg";
  msg.textContent = "Enviando…";
  li.querySelectorAll<HTMLButtonElement>("[data-verif]").forEach((b) => (b.disabled = true));
  try {
    const r = await api<{ cuenta?: boolean }>("/fuentes/verificar", { body: { url: f.url, voto: voto ?? null }, timeoutMs: 15000 });
    // Only account votes change the search (a trial id can be made up): say so instead of promising it.
    msg.textContent = !voto ? "Marca quitada"
      : !r?.cuenta ? "Gracias. Con una cuenta gratis tu voto cuenta para la búsqueda"
      : voto === "real" ? "Gracias: confirmada" : "Gracias: la búsqueda la tendrá en cuenta";
  } catch (e) {
    // The server didn't take it: undo the mark so what is shown is what counts.
    store(before);
    msg.className = "verif-msg bad";
    msg.textContent = (e as ApiError).message;
  } finally {
    li.querySelectorAll<HTMLButtonElement>("[data-verif]").forEach((b) => (b.disabled = false));
  }
}

// ---------------------------------------------------------------- sending
async function sendMessage(prompt: string) {
  if (!prompt.trim() || sending) return;
  sending = true;
  const stop = new AbortController();
  stopReply = () => stop.abort();
  setSendButton(true);
  const targetChatId = chatId;
  const usedModel = model;
  pendingModel = usedModel;
  // The chat is looked up again when the reply arrives: signing in/up meanwhile reloads the chats
  // (guest chats move to the account), so the reply goes to the chat object that exists then.
  const reply = (m: Message) => {
    const c = chats.find((x) => x.id === targetChatId);
    if (!c) return; // deleted (or another account) while waiting
    c.messages.push(m);
    c.updatedAt = Date.now();
    saveChats();
  };
  try {
    const chat = chats.find((c) => c.id === targetChatId)!;
    chat.messages.push({ role: "user", content: prompt });
    if (chat.title === "Nuevo chat") chat.title = prompt.slice(0, 40);
    chat.updatedAt = Date.now();
    pendingChatId = targetChatId;
    saveChats();
    renderMessages();
    renderChatList();
    const target = chat.messages;
    const propia = await ownKeyForRequest();
    const r = await api("/chat/completions", {
      body: {
        model: usedModel,
        messages: target.filter((m) => !m.error).map(({ role, content }) => ({ role, content })),
        stream: false,
        max_tokens: 2000,
        web: prefs.web,
        ...(propia && usedModel !== "fusion" && usedModel !== "comunidad" ? { propia } : {}),
      },
      timeoutMs: 100000,
      signal: stop.signal,
    });
    const content = r?.choices?.[0]?.message?.content;
    if (content) {
      const cut = r.choices[0].finish_reason === "length";
      reply({
        role: "assistant",
        content: cut ? `${content}\n\n⚠️ *(respuesta cortada por longitud)*` : content,
        fuentes: cleanSources(r?.libreia?.fuentes),
        meta: cleanMeta({ modo: usedModel, proveedor: r?.libreia?.proveedor, modelo: r?.libreia?.modelo }),
      });
    } else {
      reply({ role: "assistant", content: "❌ Respuesta inesperada del servidor (sin texto).", error: true });
    }
  } catch (e) {
    const err = e as ApiError;
    if (err.code === "cancelada") {
      // Marked as error so it is not sent back as context; the question stays for "Reintentar"-style resends.
      reply({ role: "assistant", content: "■ Respuesta detenida.", error: true });
      return;
    }
    const needsAccount = session.guest && err.code !== "own_key_error" && (err.status === 401 || err.status === 403 || (err.status === 429 && /prueba/i.test(err.message)));
    reply({ role: "assistant", content: needsAccount ? `🧪 ${err.message}` : `❌ No se pudo obtener respuesta.\n\n${err.message}`, error: true, cta: needsAccount });
    if (err.status === 401 && /sesi[oó]n/i.test(err.message)) {
      alert(err.message);
      logout();
    }
  } finally {
    sending = false;
    stopReply = null;
    pendingChatId = null;
    setSendButton(false);
    if (session.active) {
      renderMessages();
      renderChatList();
    }
  }
}
/** While a reply is on its way the send button becomes Stop. */
function setSendButton(busy: boolean) {
  const b = $<HTMLButtonElement>("send");
  b.classList.toggle("busy", busy);
  b.textContent = busy ? "■" : "➤";
  b.title = busy ? "Detener la respuesta" : "Enviar";
  b.setAttribute("aria-label", b.title);
}
$("send").addEventListener("click", (e) => {
  if (!sending) return;
  e.preventDefault(); // it is the Stop button now: don't submit
  stopReply?.();
});
$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  if (sending) return; // Enter while answering keeps the draft instead of discarding it
  const ta = $<HTMLTextAreaElement>("prompt");
  const text = ta.value;
  ta.value = "";
  ta.style.height = "";
  sendMessage(text);
});
$("prompt").addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Enter" && !e.shiftKey && isDesktop()) {
    e.preventDefault();
    $<HTMLFormElement>("composer").requestSubmit();
  }
});
$("prompt").addEventListener("input", () => {
  const ta = $<HTMLTextAreaElement>("prompt");
  ta.style.height = "";
  ta.style.height = Math.min(ta.scrollHeight, 150) + "px";
});
const picker = $<HTMLSelectElement>("modelPicker");
picker.value = model;
picker.addEventListener("change", () => {
  if (picker.value === "comunidad" && localStorage.getItem("libreia.comunidadOk") !== "1") {
    if (!confirm(COMMUNITY_NOTICE)) {
      picker.value = model;
      return;
    }
    localStorage.setItem("libreia.comunidadOk", "1");
  }
  model = picker.value;
  localStorage.setItem("libreia.model", model);
});

// ---------------------------------------------------------------- about / transparency
let aboutRendered = false;
async function renderAbout() {
  const el = $("aboutView");
  if (!aboutRendered) {
    el.innerHTML = ABOUT_HTML;
    aboutRendered = true;
  }
  // Without a session, "back" returns to the sign-in screen.
  el.querySelectorAll<HTMLElement>("[data-back]").forEach((b) => (b.textContent = session.active ? "← Volver al chat" : "← Volver a crear cuenta / entrar"));
  el.scrollTop = 0;
  const box = $("transparency");
  try {
    const t = await api("/transparencia", { auth: "app" });
    const n = (v: any) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("es"));
    box.innerHTML = [
      ["Cuentas", n(t.cuentas)],
      ["Activos (30 días)", n(t.activos30)],
      ["Mensajes (30 días)", n(t.mensajes30)],
      ["Mensajes en total", n(t.mensajesTotal)],
      ["Proveedores de IA activos", esc((t.proveedores || []).length)],
      ["BTC donado", t.donaciones?.btc ? esc(t.donaciones.btc.recibido) + " BTC" : "—"],
      ["USDC donado", t.donaciones?.usdc ? esc(Number(t.donaciones.usdc.recibido).toFixed(2)) + " USDC" : "—"],
    ]
      .map(([k, v]) => `<div class="t-stat"><b>${v}</b><span>${esc(k)}</span></div>`)
      .join("") + `<p class="muted small full">${esc(t.donaciones?.nota || "")} Proveedores: ${esc((t.proveedores || []).join(", "))}.</p>`;
  } catch (e) {
    box.innerHTML = `<p class="error-text">No se pudieron cargar las cifras: ${esc((e as Error).message)}</p>`;
  }
}

// ---------------------------------------------------------------- community
type Proposal = { id: number; titulo: string; texto: string; estado: string; creada: string; respuesta?: string; votos: number; mio: boolean; propia: boolean };
const ESTADO_LABEL: Record<string, string> = { abierta: "Abierta", en_curso: "En curso", hecha: "Hecha ✓", descartada: "Descartada" };
async function renderCommunity() {
  const el = $("communityView");
  el.innerHTML = `<div class="page-inner">
    <button class="back-btn" data-back type="button">← Volver al chat</button>
    <h2>Comunidad: decide el rumbo de LibreIA</h2>
    <p class="muted">Propón mejoras y vota las que quieras ver. Una cuenta, un voto. Los votos se guardan con una huella anónima de tu cuenta: nadie puede saber qué votaste.</p>
    ${session.guest ? `<div class="guest-cta"><p>🧪 En modo prueba puedes leer las propuestas. Para proponer y votar necesitas una cuenta (gratis, sin datos personales): así se cumple «una cuenta, un voto».</p><button type="button" class="primary" data-auth="registro">Crear cuenta gratis</button></div>` : ""}
    <form id="proposalForm" class="card-form${session.guest ? " hidden" : ""}">
      <input id="propTitle" maxlength="120" placeholder="Tu propuesta en una frase (ej.: añadir un modo para estudiantes)" required minlength="6">
      <textarea id="propText" maxlength="1000" rows="3" placeholder="Explica por qué sería útil (opcional)"></textarea>
      <button class="primary" type="submit">Proponer</button>
      <p id="propStatus" class="status-text" role="status"></p>
    </form>
    <div id="proposalList" class="proposal-list"><p class="muted">Cargando propuestas…</p></div>
  </div>`;
  $("proposalForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const st = $("propStatus");
    try {
      await api("/propuestas", { body: { titulo: $<HTMLInputElement>("propTitle").value, texto: $<HTMLTextAreaElement>("propText").value } });
      st.textContent = "✓ Propuesta publicada. ¡Gracias!";
      $<HTMLInputElement>("propTitle").value = "";
      $<HTMLTextAreaElement>("propText").value = "";
      loadProposals();
    } catch (ex) {
      st.textContent = (ex as Error).message;
    }
  });
  $("proposalList").addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-vote]");
    if (!b) return;
    if (session.guest) {
      if (confirm("Para votar necesitas una cuenta gratis (una cuenta, un voto). ¿Crearla ahora?")) goToAuth("registro");
      return;
    }
    b.disabled = true;
    try {
      await api("/propuestas/votar", { body: { propuesta: Number(b.dataset.vote) } });
      await loadProposals();
    } catch (ex) {
      alert((ex as Error).message);
      b.disabled = false;
    }
  });
  loadProposals();
}
async function loadProposals() {
  const list = $("proposalList");
  try {
    const { propuestas } = await api<{ propuestas: Proposal[] }>("/propuestas");
    list.innerHTML =
      propuestas
        .map(
          (p) => `<article class="proposal ${esc(p.estado)}">
            <button type="button" class="vote ${p.mio ? "voted" : ""}" data-vote="${p.id}" title="${p.mio ? "Quitar mi voto" : "Votar"}">▲<b>${p.votos}</b></button>
            <div><h3>${esc(p.titulo)}</h3>${p.texto ? `<p>${esc(p.texto)}</p>` : ""}
              <div class="proposal-meta"><span class="badge">${esc(ESTADO_LABEL[p.estado] || p.estado)}</span>${p.propia ? `<span class="badge">Tu propuesta</span>` : ""}<span>${esc(p.creada)}</span></div>
              ${p.respuesta ? `<p class="answer"><b>Respuesta del proyecto:</b> ${esc(p.respuesta)}</p>` : ""}</div>
          </article>`,
        )
        .join("") || `<p class="muted">Aún no hay propuestas. ¡Haz la primera!</p>`;
  } catch (e) {
    list.innerHTML = `<p class="error-text">${esc((e as Error).message)}</p>`;
  }
}

// ---------------------------------------------------------------- settings & my data
function openSettings() {
  $<HTMLInputElement>("webInput").checked = prefs.web;
  $<HTMLInputElement>("statsInput").checked = prefs.stats;
  $("accountEmail").textContent = session.email || "—";
  $("guestSection").classList.toggle("hidden", !session.guest);
  $("accountSection").classList.toggle("hidden", session.guest);
  $("settingsStatus").textContent = "";
  void fillOwnKeyForm();
  settingsDialog.showModal();
}

// ---------------------------------------------------------------- appearance (skin + day/night)
function readLook(): Look {
  try {
    const a = JSON.parse(localStorage.getItem("libreia.apariencia") || "{}");
    return { piel: SKINS.some((k) => k.id === a.piel) ? a.piel : "pancarta", modo: a.modo === "claro" ? "claro" : "oscuro" };
  } catch {
    return { piel: "pancarta", modo: "oscuro" };
  }
}
function applyLook(l: Look, save = true) {
  const root = document.documentElement;
  root.dataset.piel = l.piel;
  root.dataset.modo = l.modo;
  if (save) {
    try {
      localStorage.setItem("libreia.apariencia", JSON.stringify(l));
    } catch {
      /* private mode: it still applies for this visit */
    }
  }
  const day = l.modo === "claro";
  const toggle = $("modeToggle");
  toggle.title = day ? "Cambiar a modo noche" : "Cambiar a modo día";
  toggle.setAttribute("aria-label", toggle.title);
  document.querySelectorAll<HTMLElement>(".piel").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.piel === l.piel)));
  document.querySelectorAll<HTMLElement>(".modo-row [data-modo]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.modo === l.modo)));
  // Browser chrome and the Android status bar follow the page background.
  const bg = getComputedStyle(root).getPropertyValue("--bg").trim() || "#090b10";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  if (IS_NATIVE) {
    import("@capacitor/status-bar")
      .then(({ StatusBar, Style }) =>
        Promise.all([StatusBar.setBackgroundColor({ color: bg }), StatusBar.setStyle({ style: day ? Style.Light : Style.Dark })]),
      )
      .catch(() => {
        /* older Android or plugin missing: the bar keeps its colour */
      });
  }
}
$("modeToggle").addEventListener("click", () => {
  const l = readLook();
  applyLook({ ...l, modo: l.modo === "claro" ? "oscuro" : "claro" });
});
settingsDialog.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const skin = t.closest<HTMLElement>(".piel");
  if (skin) return applyLook({ ...readLook(), piel: skin.dataset.piel as Skin });
  const mode = t.closest<HTMLElement>(".modo-row [data-modo]");
  if (mode) applyLook({ ...readLook(), modo: mode.dataset.modo === "claro" ? "claro" : "oscuro" });
});
applyLook(readLook(), false);

// ---------------------------------------------------------------- volunteer node
$("nodeTokenBtn").addEventListener("click", async () => {
  const st = $("nodeStatus");
  st.textContent = "Generando…";
  try {
    const r = await api<{ token: string }>("/red/token", { body: {}, timeoutMs: 15000 });
    if (!/^n1\.[0-9a-f.]+$/.test(r.token || "")) throw new Error("Respuesta inesperada del servidor");
    $("nodeCmd").textContent = `node libreia-nodo.mjs --token ${r.token} --nombre TuAlias`;
    $("nodeTokenBox").classList.remove("hidden");
    st.textContent = "✓ Token listo. Cambia «TuAlias» por el nombre público de tu nodo (o quítalo). Si usas LM Studio añade --api http://127.0.0.1:1234/v1.";
  } catch (ex) {
    st.textContent = (ex as Error).message;
  }
});
$("nodeCopy").addEventListener("click", () => {
  copyText($("nodeCmd").textContent || "").then(
    () => ($("nodeStatus").textContent = "✓ Comando copiado. Guárdalo como una contraseña: quien lo tenga puede conectar un nodo a tu nombre."),
    () => ($("nodeStatus").textContent = "No se pudo copiar: selecciónalo a mano."),
  );
});

// ---------------------------------------------------------------- own provider key
const ownProv = $<HTMLSelectElement>("ownProv");
function ownHelp() {
  const p = OWN_PROVIDERS[ownProv.value];
  $("ownHelp").innerHTML = `Consigue una clave en <a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" data-external>${esc(p.url.replace(/^https:\/\//, ""))}</a> (${esc(p.nota)}).`;
}
async function fillOwnKeyForm() {
  const k = await loadOwnKey();
  ownProv.value = k?.proveedor || "groq";
  ownHelp();
  $<HTMLInputElement>("ownKey").value = "";
  $<HTMLInputElement>("ownKey").placeholder = k ? `Guardada (${keyHint(k.clave)}). Pega otra para cambiarla` : "Pega aquí tu clave";
  $<HTMLInputElement>("ownModel").value = k?.modelo || OWN_PROVIDERS[ownProv.value].modelo;
  $<HTMLInputElement>("ownOn").checked = k ? k.activa : true;
  $("ownRemove").classList.toggle("hidden", !k);
  $("ownStatus").textContent = k ? (k.activa ? `✓ Usando tu clave de ${OWN_PROVIDERS[k.proveedor].nombre}.` : "Tu clave está guardada pero desactivada.") : "";
}
/** The key typed in the form, or the saved one when the field is empty and the provider is the same. */
async function ownKeyInForm(): Promise<string> {
  const typed = $<HTMLInputElement>("ownKey").value.trim();
  if (typed) return typed;
  const k = await loadOwnKey();
  return k && k.proveedor === ownProv.value ? k.clave : "";
}
async function refreshOwnState() {
  const k = await loadOwnKey();
  ownActive = !!(k && k.activa && k.modelo);
  if (k) $("ownBarText").textContent = `${OWN_PROVIDERS[k.proveedor].nombre} · ${k.modelo}`;
  applyGuestUi();
}
ownProv.addEventListener("change", async () => {
  ownHelp();
  const k = await loadOwnKey();
  $<HTMLInputElement>("ownModel").value = k?.proveedor === ownProv.value ? k.modelo : OWN_PROVIDERS[ownProv.value].modelo;
  $("ownModels").innerHTML = "";
});
$("ownList").addEventListener("click", async () => {
  const st = $("ownStatus");
  const clave = await ownKeyInForm();
  if (!clave) return void (st.textContent = "Pega primero tu clave.");
  st.textContent = "Consultando los modelos de tu proveedor…";
  try {
    const r = await api<{ modelos: string[] }>("/propia/modelos", { body: { proveedor: ownProv.value, clave }, timeoutMs: 15000 });
    const lista = Array.isArray(r.modelos) ? r.modelos.filter((m) => typeof m === "string") : [];
    $("ownModels").innerHTML = lista.map((m) => `<option value="${esc(m)}"></option>`).join("");
    st.textContent = lista.length ? `${lista.length} modelos disponibles: toca el campo «Modelo» para elegir.` : "El proveedor no devolvió modelos de chat.";
    if (lista.length && !$<HTMLInputElement>("ownModel").value) $<HTMLInputElement>("ownModel").value = lista[0];
  } catch (ex) {
    st.textContent = (ex as Error).message;
  }
});
$("ownKeyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const st = $("ownStatus");
  const clave = await ownKeyInForm();
  const modelo = $<HTMLInputElement>("ownModel").value.trim().replace(/^models\//, "");
  if (!clave) return void (st.textContent = "Pega tu clave.");
  if (!/^[\x21-\x7e]{8,400}$/.test(clave)) return void (st.textContent = "La clave no parece válida (sin espacios, mínimo 8 caracteres).");
  if (!modelo) return void (st.textContent = "Escribe un modelo o toca «Ver modelos».");
  st.textContent = "Probando tu clave con un mensaje corto…";
  try {
    const r = await api<{ ok: boolean; error?: string; ms?: number }>("/propia/probar", { body: { proveedor: ownProv.value, clave, modelo }, timeoutMs: 40000 });
    if (!r.ok) return void (st.textContent = `✗ Tu proveedor respondió con un error: ${r.error || "desconocido"}. No se guardó.`);
    await saveOwnKey({ proveedor: ownProv.value, clave, modelo, activa: $<HTMLInputElement>("ownOn").checked });
    await refreshOwnState();
    await fillOwnKeyForm();
    st.textContent = `✓ Funciona (${((r.ms || 0) / 1000).toFixed(1)} s) y quedó guardada cifrada en este dispositivo.`;
  } catch (ex) {
    st.textContent = (ex as Error).message;
  }
});
$("ownOn").addEventListener("change", async () => {
  if (!(await loadOwnKey())) return; // not saved yet: the switch applies when saving
  updateOwnKey({ activa: $<HTMLInputElement>("ownOn").checked });
  await refreshOwnState();
  await fillOwnKeyForm();
});
$("ownRemove").addEventListener("click", async () => {
  if (!confirm("¿Quitar tu clave de este dispositivo? Volverás a usar el cupo común.")) return;
  clearOwnKey();
  await refreshOwnState();
  await fillOwnKeyForm();
  $("ownStatus").textContent = "Clave quitada de este dispositivo.";
});
$("webInput").addEventListener("change", (e) => (prefs.web = (e.target as HTMLInputElement).checked));
$("statsInput").addEventListener("change", (e) => (prefs.stats = (e.target as HTMLInputElement).checked));
$("logoutBtn").addEventListener("click", () => {
  if (confirm("¿Cerrar sesión? Tus chats se quedan guardados en este dispositivo.")) logout();
});

function download(name: string, content: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const stamp = () => new Date().toISOString().slice(0, 10);
$("exportJson").addEventListener("click", () => {
  download(`libreia-chats-${stamp()}.json`, JSON.stringify({ app: "LibreIA", version: 1, exportado: new Date().toISOString(), chats }, null, 2), "application/json");
  $("settingsStatus").textContent = "✓ Chats exportados. Guarda el archivo en un lugar seguro.";
});
$("exportMd").addEventListener("click", () => {
  const md = chats
    .filter((c) => c.messages.length)
    .map((c) => `# ${c.title}\n\n` + c.messages.map((m) => `**${m.role === "user" ? "Tú" : "LibreIA"}:**\n\n${m.content}${m.fuentes?.length ? "\n\nFuentes:\n" + m.fuentes.map((f) => `${f.n}. ${f.titulo} — ${f.url}${f.voto === "real" ? " (verificada: real)" : f.voto === "falsa" ? " (verificada: NO real)" : ""}`).join("\n") : ""}`).join("\n\n---\n\n"))
    .join("\n\n\n");
  download(`libreia-chats-${stamp()}.md`, md, "text/markdown");
  $("settingsStatus").textContent = "✓ Chats exportados en Markdown.";
});
$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error("el archivo es demasiado grande (máx. 20 MB)");
    const data = JSON.parse(await file.text());
    const incoming = cleanChats(Array.isArray(data) ? data : data?.chats);
    const before = chats;
    const nuevos = incoming.filter((c) => !before.some((x) => x.id === c.id));
    const added = nuevos.length;
    chats = [...before, ...nuevos];
    if (!saveChats()) {
      chats = before; // nothing half-imported
      throw new Error("no hay espacio en el dispositivo");
    }
    renderChatList();
    $("settingsStatus").textContent = `✓ ${added} chat(s) importados${incoming.length - added ? ` (${incoming.length - added} ya existían)` : ""}.`;
  } catch (ex) {
    $("settingsStatus").textContent = "No se pudo importar: " + (ex as Error).message;
  } finally {
    (e.target as HTMLInputElement).value = "";
  }
});
$("wipeChats").addEventListener("click", () => {
  if (!confirm("¿Borrar TODOS tus chats de este dispositivo? No se puede deshacer (exporta antes si quieres conservarlos).")) return;
  chats = [];
  chatId = "";
  newChat(false);
  saveChats();
  renderChatList();
  renderMessages();
  $("settingsStatus").textContent = "✓ Chats borrados de este dispositivo.";
});

$("passForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const st = $("settingsStatus");
  const email = session.email;
  const old = $<HTMLInputElement>("passOld").value;
  const nw = $<HTMLInputElement>("passNew").value;
  if (!email) return void (st.textContent = "Vuelve a entrar para cambiar la contraseña.");
  if (nw.length < 10) return void (st.textContent = "La nueva contraseña debe tener al menos 10 caracteres.");
  if (nw !== $<HTMLInputElement>("passNew2").value) return void (st.textContent = "Las contraseñas nuevas no coinciden.");
  st.textContent = "Protegiendo tus datos en este dispositivo…";
  try {
    const a = await deriveCredentials(email, old);
    const b = await deriveCredentials(email, nw);
    const r = await api<{ sesion?: string }>("/cuenta/contrasena", {
      body: { correoHash: a.correoHash, kdf: 2, claveActual: a.clave, claveActualAnterior: a.claveAnterior, claveNueva: b.clave },
      timeoutMs: 20000,
    });
    // The server closes every other session; this device gets a fresh one.
    if (r.sesion && session.ns) session.save(r.sesion, email, session.ns);
    (e.target as HTMLFormElement).reset();
    st.textContent = "✓ Contraseña cambiada. Guárdala bien: no se puede recuperar.";
  } catch (ex) {
    st.textContent = (ex as Error).message;
  }
});
$("deleteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const st = $("settingsStatus");
  const email = session.email;
  if (!email) return void (st.textContent = "Vuelve a entrar para borrar la cuenta.");
  if (!confirm("¿Borrar tu cuenta para siempre? No se puede deshacer.")) return;
  try {
    const c = await deriveCredentials(email, $<HTMLInputElement>("deletePass").value);
    await api("/cuenta/borrar", { body: c, timeoutMs: 20000 });
    alert("Tu cuenta se borró. Tus chats siguen en este dispositivo hasta que los borres.");
    logout();
  } catch (ex) {
    st.textContent = (ex as Error).message;
  }
});

// ---------------------------------------------------------------- support dialog
const COIN_OF: Record<string, string> = { dirUsdc: "usdc", dirBtc: "btc", dirXmr: "xmr", ethereum: "usdc", bitcoin: "btc", monero: "xmr" };
supportDialog.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const status = $("donStatus");
  const copyBtn = t.closest<HTMLElement>("[data-copy]");
  if (copyBtn) {
    const text = supportDialog.querySelector("#" + CSS.escape(copyBtn.dataset.copy!))?.textContent?.trim() || "";
    if (COIN_OF[copyBtn.dataset.copy!]) sendEvent(`copiar:${COIN_OF[copyBtn.dataset.copy!]}`);
    copyText(text).then(
      () => (status.textContent = "Dirección copiada."),
      () => (status.textContent = "No se pudo copiar: mantén pulsada la dirección para seleccionarla."),
    );
    return;
  }
  const w = t.closest<HTMLElement>("[data-wallet]");
  if (w) {
    status.textContent = "Abriendo billetera… Si no se abre ninguna, copia la dirección.";
    const scheme = w.dataset.wallet!.split(":")[0];
    if (COIN_OF[scheme]) sendEvent(`billetera:${COIN_OF[scheme]}`);
    window.location.href = w.dataset.wallet!;
  }
});

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (!ok) throw new Error("copy failed");
  }
}

// ---------------------------------------------------------------- connection status
async function checkConnection() {
  try {
    await api("/models", { auth: "app" });
    $("connectionStatus").textContent = "Conectado";
    $("connectionDot").className = "dot online";
  } catch (e) {
    $("connectionStatus").textContent = "Sin conexión: " + (e as Error).message.slice(0, 60);
    $("connectionDot").className = "dot offline";
  }
}

// ---------------------------------------------------------------- start
function startApp() {
  showView("chat"); // first, so a rendering problem can never leave a blank screen
  try {
    loadChats();
    renderChatList();
    renderMessages();
  } catch (e) {
    console.error(e);
    messagesEl.innerHTML = `<p class="error-text">No se pudieron mostrar tus chats (${esc((e as Error).message)}). Puedes exportarlos en Configuración.</p>`;
  }
  if (isDesktop() && localStorage.getItem("libreia.menuOculto") !== "si") shell.classList.remove("collapsed");
  showView("chat");
  checkConnection();
}

sendEvent("app_abierta");
setAuthMode(session.token ? "entrar" : "registro");
// Links from the website: ?probar=1 starts trial mode, ?cuenta=registro|entrar opens that tab.
const params = new URLSearchParams(location.search);
if (params.has("probar") || params.has("cuenta")) history.replaceState(null, "", location.pathname);
const trial = loadTrialInfo();
void refreshOwnState();
if (session.active) startApp();
else if (params.has("probar")) {
  // Only start trial mode if the server allows it (otherwise show sign-up).
  showView("chat");
  trial.then((activa) => {
    if (activa && !session.active) startGuest();
  });
} else {
  if (params.get("cuenta") === "entrar") setAuthMode("entrar");
  showView("chat");
}
