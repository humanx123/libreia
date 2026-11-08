// Backend access + account cryptography for LibreIA.

export const API_URL = "https://libreia-api.libreia-chat-mobile.workers.dev/v1";
// Public app token (it ships inside the APK): only lets the app call the account endpoints,
// read the model list and send anonymous events. Chatting requires an account session.
const APP_TOKEN = "libreia-app-e72d00ec863b469558e65a31d8730d95637afc1c";
export const APP_VERSION = "0.12.0";

const isNative = (window as any).Capacitor?.isNativePlatform?.() ?? false;
export const PLATFORM = isNative ? "android" : "web";
export const IS_NATIVE = isNative;

// ---------------------------------------------------------------- session
export const GUEST_NS = "invitado";
export const session = {
  get token(): string | null {
    return localStorage.getItem("libreia.sesion");
  },
  /** Email kept ONLY on this device (to show it and to re-derive keys); never sent in clear. */
  get email(): string | null {
    return localStorage.getItem("libreia.correo");
  },
  get ns(): string | null {
    return localStorage.getItem("libreia.ns");
  },
  /** Trial mode: chatting without an account (small hourly quota per IP, no Fusion, no votes). */
  get guest(): boolean {
    return !this.token && localStorage.getItem("libreia.invitado") === "si";
  },
  /** Signed in or trying it out: the chat is usable. */
  get active(): boolean {
    return !!this.token || this.guest;
  },
  startGuest() {
    localStorage.setItem("libreia.invitado", "si");
    localStorage.setItem("libreia.ns", GUEST_NS);
  },
  save(token: string, email: string, ns: string) {
    localStorage.removeItem("libreia.invitado");
    localStorage.setItem("libreia.sesion", token);
    localStorage.setItem("libreia.correo", email);
    localStorage.setItem("libreia.ns", ns);
  },
  clear() {
    localStorage.removeItem("libreia.sesion");
    localStorage.removeItem("libreia.correo");
    localStorage.removeItem("libreia.ns");
    localStorage.removeItem("libreia.invitado");
  },
};

// ---------------------------------------------------------------- stats prefs
export const prefs = {
  get stats() {
    return localStorage.getItem("libreia.estadisticas") !== "no";
  },
  set stats(v: boolean) {
    localStorage.setItem("libreia.estadisticas", v ? "si" : "no");
  },
  get web() {
    return localStorage.getItem("libreia.web") !== "no";
  },
  set web(v: boolean) {
    localStorage.setItem("libreia.web", v ? "si" : "no");
  },
};

function installId(): string {
  let id = localStorage.getItem("libreia.instalacion");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    id = globalThis.crypto?.randomUUID?.() || "00000000-0000-4000-8000-" + Date.now().toString(16).padStart(12, "0").slice(-12);
    localStorage.setItem("libreia.instalacion", id);
  }
  return id;
}

// ---------------------------------------------------------------- HTTP
export class ApiError extends Error {
  constructor(message: string, public status: number, public code = "", public data: Record<string, unknown> = {}) {
    super(message);
  }
}

function messageFrom(status: number, raw: string): string {
  let detail = raw.slice(0, 300);
  try {
    const d = JSON.parse(raw);
    detail = d?.error?.message || (typeof d?.error === "string" ? d.error : "") || d?.message || detail;
  } catch {
    /* plain text */
  }
  return detail || `HTTP ${status}`;
}

/** Calls the LibreIA API. The timeout is enforced with a race because Capacitor's fetch ignores AbortSignal on POST. */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; timeoutMs?: number; auth?: "session" | "app" } = {}): Promise<T> {
  const headers: Record<string, string> = {
    "X-LibreIA-Plataforma": PLATFORM,
    "X-LibreIA-Version": APP_VERSION,
  };
  const token = opts.auth === "app" ? APP_TOKEN : session.token || APP_TOKEN;
  headers.Authorization = `Bearer ${token}`;
  if (prefs.stats) headers["X-LibreIA-Instalacion"] = installId();
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const timeoutMs = opts.timeoutMs ?? 15000;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ApiError(`Tiempo agotado (${Math.round(timeoutMs / 1000)} s) esperando al servidor`, 0));
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([
      fetch(API_URL + path, {
        method: opts.method || (opts.body !== undefined ? "POST" : "GET"),
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      }),
      timeout,
    ]);
    const text = await res.text();
    if (!res.ok) {
      let code = "";
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(text) || {};
        code = String(data.codigo || "");
      } catch {
        /* plain text */
      }
      throw new ApiError(messageFrom(res.status, text), res.status, code, data);
    }
    return JSON.parse(text) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(`No se pudo conectar con el servidor (${(e as Error).message})`, 0);
  } finally {
    clearTimeout(timer);
  }
}

export function sendEvent(tipo: string) {
  if (!prefs.stats) return;
  api("/eventos", { body: { tipo }, timeoutMs: 10000, auth: "app" }).catch(() => {});
}

// ---------------------------------------------------------------- account crypto
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
// Unicode normalisation: the same email/password typed on another keyboard gives the same keys.
// (ASCII input is unchanged, so existing accounts keep working.)
export const normalizeEmail = (e: string) => e.normalize("NFKC").trim().toLowerCase();

export async function emailHash(email: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("libreia-correo:" + normalizeEmail(email))));
}

/**
 * Everything sensitive is transformed on this device:
 *   correoHash    = SHA-256(email)                       → the server never sees the email
 *   claveAnterior = PBKDF2(password, 200k)               → kdf 1 (accounts created before 0.10)
 *   clave         = PBKDF2(claveAnterior, 400k)          → kdf 2: 600k rounds in total
 * Chaining means kdf 1 comes for free, so an old account is upgraded on its next sign-in
 * without asking anything; once upgraded, the server no longer accepts the kdf 1 value.
 */
export async function deriveCredentials(email: string, password: string) {
  const e = normalizeEmail(email);
  const enc = new TextEncoder();
  const pbkdf2 = async (raw: BufferSource, salt: string, iterations: number) => {
    const key = await crypto.subtle.importKey("raw", raw, "PBKDF2", false, ["deriveBits"]);
    return crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations, hash: "SHA-256" }, key, 256);
  };
  const v1 = await pbkdf2(enc.encode(password.normalize("NFC")), "libreia-clave:" + e, 200000);
  const v2 = await pbkdf2(v1, "libreia-clave2:" + e, 400000);
  return { correoHash: await emailHash(e), kdf: 2, clave: hex(v2), claveAnterior: hex(v1) };
}
