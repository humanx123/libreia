// Búsqueda web gratuita para dar referencias reales a las respuestas.
//   1. Keenable (keyless: POST /v1/search/public, ~1000 búsquedas/hora por IP) con extractos.
//   2. Wikipedia en español como respaldo (API pública sin clave).
// Si las dos fallan, la respuesta sigue sin fuentes y el motivo queda registrado.

const KEENABLE_URL = "https://api.keenable.ai/v1/search/public";
const TIEMPO_BUSQUEDA_MS = 8000;
const MAX_EXTRACTO = 700;

const limpiar = (t) => String(t || "").replace(/\s+/g, " ").trim();

function dominio(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function keenable(consulta, n) {
  const res = await fetch(KEENABLE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Keenable-Title": "libreia" },
    body: JSON.stringify({ query: consulta, max_results: n + 3 }),
    signal: AbortSignal.timeout(TIEMPO_BUSQUEDA_MS),
  });
  if (!res.ok) throw new Error(`Keenable HTTP ${res.status}`);
  const datos = await res.json();
  return (Array.isArray(datos?.results) ? datos.results : []).map((r) => ({
    titulo: limpiar(r.title),
    url: String(r.url || ""),
    extracto: limpiar(r.snippet || r.description),
  }));
}

async function wikipedia(consulta, n) {
  const url = `https://es.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(consulta)}&gsrlimit=${n}&prop=extracts|info&exintro=1&explaintext=1&exchars=${MAX_EXTRACTO}&inprop=url&format=json&origin=*`;
  const res = await fetch(url, {
    headers: { "User-Agent": "LibreIA/1.0 (https://libre-ia.pages.dev)" },
    signal: AbortSignal.timeout(TIEMPO_BUSQUEDA_MS),
  });
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
  const paginas = Object.values((await res.json())?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  return paginas.map((p) => ({ titulo: limpiar(p.title), url: p.fullurl, extracto: limpiar(p.extract) }));
}

/**
 * Busca y devuelve hasta n fuentes únicas: [{ n, titulo, url, dominio, extracto }].
 * Nunca lanza: devuelve { fuentes, motor, error }.
 */
export async function buscarWeb(consulta, n = 5) {
  const q = limpiar(consulta).slice(0, 300);
  if (!q) return { fuentes: [], motor: null, error: "consulta vacía" };
  const errores = [];
  for (const [nombre, fn] of [["keenable", keenable], ["wikipedia", wikipedia]]) {
    try {
      const vistos = new Set();
      const fuentes = [];
      for (const r of await fn(q, n)) {
        if (!/^https?:\/\//.test(r.url) || !r.extracto) continue;
        // Una misma página a veces sale dos veces (HTML y PDF): se deja la primera.
        const clave = r.url.split(/[?#]/)[0].replace(/\/$/, "");
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        const dom = dominio(r.url);
        const t = r.titulo.replace(/^['"«“]+|['"»”]+$/g, "").trim();
        const titulo = !t || /^(untitled|sin título)$/i.test(t) ? dom : t;
        fuentes.push({ n: fuentes.length + 1, titulo: titulo.slice(0, 160), url: r.url, dominio: dom, extracto: r.extracto.slice(0, MAX_EXTRACTO) });
        if (fuentes.length >= n) break;
      }
      if (fuentes.length) return { fuentes, motor: nombre, error: errores.join(" | ") || null };
      errores.push(`${nombre}: sin resultados`);
    } catch (e) {
      errores.push(`${nombre}: ${e.name === "TimeoutError" ? "tiempo agotado" : e.message}`);
    }
  }
  return { fuentes: [], motor: null, error: errores.join(" | ") };
}

/** ¿Merece la pena buscar? Saludos y mensajes muy cortos no aportan nada a un buscador. */
export function vale_la_pena_buscar(texto) {
  const t = limpiar(texto).toLowerCase();
  if (t.length < 12) return false;
  return !/^(hola|buenas|gracias|ok|vale|adiós|adios|hi|hello|thanks)\b[\s!.?¡¿]*$/.test(t);
}

/** Bloque de contexto para el mensaje de sistema. */
export function contextoFuentes(fuentes) {
  return (
    "\n\n## Resultados de búsqueda web (consultados ahora)\n" +
    fuentes.map((f) => `[${f.n}] ${f.titulo} — ${f.url}\n${f.extracto}`).join("\n\n") +
    "\n\nUsa estos resultados cuando sean pertinentes y cita cada dato que tomes de ellos con su número entre corchetes, " +
    "por ejemplo [1] o [2][3], justo después de la frase. No inventes fuentes ni números que no estén en la lista. " +
    "Si los resultados no responden la pregunta, dilo y responde con tu propio conocimiento. " +
    "No incluyas al final una lista de fuentes: la aplicación ya la muestra."
  );
}
