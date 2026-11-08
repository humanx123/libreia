// "Bring your own key": the user's own provider key, stored only on this device.
//
// The key is encrypted with AES-GCM using a device key that is generated as NON-EXTRACTABLE and
// kept in IndexedDB: its raw bytes can never be read back, not even by this app. So the key does
// not show up in plain text in localStorage, backups, exports or a copied browser profile.
// (Anything running inside the page can still *use* it, as with any secret the page sends.)

export type OwnKey = { proveedor: string; clave: string; modelo: string; activa: boolean };

export const OWN_PROVIDERS: Record<string, { nombre: string; url: string; nota: string; modelo: string }> = {
  groq: { nombre: "Groq", url: "https://console.groq.com/keys", nota: "gratis, muy rápido", modelo: "openai/gpt-oss-120b" },
  google: { nombre: "Google Gemini", url: "https://aistudio.google.com/apikey", nota: "gratis con cuenta de Google", modelo: "gemini-3.5-flash" },
  openrouter: { nombre: "OpenRouter", url: "https://openrouter.ai/keys", nota: "modelos «:free» gratis", modelo: "openrouter/free" },
  cerebras: { nombre: "Cerebras", url: "https://cloud.cerebras.ai", nota: "gratis", modelo: "" },
  mistral: { nombre: "Mistral", url: "https://console.mistral.ai/api-keys", nota: "plan gratuito «Experiment»", modelo: "mistral-small-latest" },
  nvidia: { nombre: "NVIDIA", url: "https://build.nvidia.com", nota: "créditos gratis", modelo: "nvidia/nemotron-3-ultra-550b-a55b" },
  sambanova: { nombre: "SambaNova", url: "https://cloud.sambanova.ai/apis", nota: "gratis", modelo: "" },
  deepseek: { nombre: "DeepSeek", url: "https://platform.deepseek.com/api_keys", nota: "de pago, barato", modelo: "deepseek-chat" },
  openai: { nombre: "OpenAI", url: "https://platform.openai.com/api-keys", nota: "de pago", modelo: "" },
};

const LS = "libreia.clavePropia";
const DB = "libreia-llaves";
const STORE = "llaves";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbDo<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return idb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => { db.close(); resolve(req.result); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      }),
  );
}
async function deviceKey(create: boolean): Promise<CryptoKey | null> {
  const k = await idbDo<CryptoKey | undefined>("readonly", (s) => s.get("aes"));
  if (k || !create) return k || null;
  const nueva = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await idbDo("readwrite", (s) => s.put(nueva, "aes"));
  return nueva;
}
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

let cache: OwnKey | null | undefined;

/** Reads the saved key (null if none, or if it can no longer be decrypted). */
export async function loadOwnKey(): Promise<OwnKey | null> {
  if (cache !== undefined) return cache;
  cache = null;
  try {
    const raw = JSON.parse(localStorage.getItem(LS) || "null");
    if (!raw || !OWN_PROVIDERS[raw.proveedor] || typeof raw.iv !== "string" || typeof raw.ct !== "string") return null;
    const key = await deviceKey(false);
    if (!key) return null; // the device key is gone (site data cleared): the key must be entered again
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(raw.iv) }, key, unb64(raw.ct));
    cache = { proveedor: raw.proveedor, clave: new TextDecoder().decode(plain), modelo: String(raw.modelo || ""), activa: raw.activa !== false };
  } catch {
    cache = null;
  }
  return cache;
}

export async function saveOwnKey(k: OwnKey): Promise<void> {
  const key = await deviceKey(true);
  if (!key) throw new Error("Este dispositivo no permite guardar la clave cifrada");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(k.clave));
  localStorage.setItem(LS, JSON.stringify({ proveedor: k.proveedor, modelo: k.modelo, activa: k.activa, iv: b64(iv), ct: b64(ct) }));
  cache = { ...k };
}

/** Changes only the on/off switch or the model (the encrypted key stays as it is). */
export function updateOwnKey(patch: Partial<Pick<OwnKey, "activa" | "modelo">>) {
  try {
    const raw = JSON.parse(localStorage.getItem(LS) || "null");
    if (!raw) return;
    localStorage.setItem(LS, JSON.stringify({ ...raw, ...patch }));
    if (cache) cache = { ...cache, ...patch };
  } catch {
    /* nothing saved */
  }
}

export function clearOwnKey() {
  localStorage.removeItem(LS);
  cache = null;
}

/** What the chat request sends, or null when there is no active key. */
export async function ownKeyForRequest(): Promise<{ proveedor: string; clave: string; modelo: string } | null> {
  const k = await loadOwnKey();
  return k && k.activa && k.modelo ? { proveedor: k.proveedor, clave: k.clave, modelo: k.modelo } : null;
}

/** "…abcd": only the last characters, to recognise which key is saved. */
export const keyHint = (clave: string) => (clave.length > 10 ? "…" + clave.slice(-4) : "…");
