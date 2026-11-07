// Cifrado compartido entre el Worker principal y el panel de administración.
// AES-256-GCM con la clave maestra MASTER_KEY (32 bytes en base64, secreto en ambos Workers).
// Formato del texto cifrado: "v1.<iv base64>.<datos base64>".

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const desdeB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function claveAes(maestra) {
  const bytes = desdeB64(maestra);
  if (bytes.length !== 32) throw new Error("MASTER_KEY debe tener 32 bytes en base64");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function cifrar(maestra, objeto) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const datos = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await claveAes(maestra), new TextEncoder().encode(JSON.stringify(objeto)));
  return `v1.${b64(iv)}.${b64(datos)}`;
}

export async function descifrar(maestra, texto) {
  const [version, iv, datos] = String(texto).split(".");
  if (version !== "v1" || !iv || !datos) throw new Error("formato de cifrado desconocido");
  const plano = await crypto.subtle.decrypt({ name: "AES-GCM", iv: desdeB64(iv) }, await claveAes(maestra), desdeB64(datos));
  return JSON.parse(new TextDecoder().decode(plano));
}

/** Comparación en tiempo constante de dos textos. */
export function igualesSeguro(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diferencia = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diferencia |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diferencia === 0;
}
