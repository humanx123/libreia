// Estadísticas anónimas de LibreIA: solo números agregados.
// No se guarda contenido de mensajes, IPs ni datos personales. Cada instalación de la app
// manda un id aleatorio; aquí solo se guarda su HMAC (no reversible) para contar usuarios únicos.
//
// Un único Durable Object (idFromName("global")) con SQLite: entra en el plan gratuito
// (100k filas escritas/día) y no gasta las 1000 escrituras diarias de KV.

const DIAS_RETENCION_ACTIVOS = 90;

export const EVENTOS_APP = new Set([
  "app_abierta",
  "donar_abierto",
  "prueba_iniciada",
  "copiar:usdc", "copiar:btc", "copiar:xmr",
  "billetera:usdc", "billetera:btc", "billetera:xmr",
]);

const hoy = () => new Date().toISOString().slice(0, 10);
const haceDias = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const texto = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

/** Llamado desde el Worker principal (siempre en waitUntil: nunca retrasa ni rompe el chat). */
export async function registrarEstadistica(env, request, claves) {
  if (!env.ESTADISTICAS) return;
  try {
    const instalacion = request.headers.get("X-LibreIA-Instalacion") || "";
    let id = null;
    // Solo ids con forma de UUID; el hash usa un secreto para que no se pueda revertir.
    if (/^[0-9a-f-]{36}$/i.test(instalacion) && env.INTERNAL_TOKEN) {
      const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.INTERNAL_TOKEN), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const firma = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode("instalacion:" + instalacion.toLowerCase()));
      id = [...new Uint8Array(firma)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    const plataforma = ["android", "web"].includes(request.headers.get("X-LibreIA-Plataforma")) ? request.headers.get("X-LibreIA-Plataforma") : "otra";
    const version = texto(request.headers.get("X-LibreIA-Version"), 16).replace(/[^0-9a-z.\-]/gi, "") || "?";
    const stub = env.ESTADISTICAS.get(env.ESTADISTICAS.idFromName("global"));
    await stub.fetch("https://estadisticas/registrar", {
      method: "POST",
      // La plataforma se cuenta solo para mensajes (los eventos ya llevan su propio nombre).
      body: JSON.stringify({ claves: claves.includes("mensajes") ? [...claves, `plataforma:${plataforma}`] : claves, id, plataforma, version }),
    });
  } catch (e) {
    console.error("estadísticas:", e.message);
  }
}

export class Estadisticas {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS contadores (dia TEXT NOT NULL, clave TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (dia, clave));
      CREATE TABLE IF NOT EXISTS instalaciones (id TEXT PRIMARY KEY, primera TEXT NOT NULL, ultima TEXT NOT NULL, plataforma TEXT, version TEXT);
      CREATE TABLE IF NOT EXISTS activos (dia TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (dia, id));
      CREATE TABLE IF NOT EXISTS valores (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
    `);
    this.vistosHoy = new Set();
    this.diaVistos = "";
  }

  async fetch(request) {
    const ruta = new URL(request.url).pathname;
    if (ruta === "/registrar") return this.registrar(await request.json());
    if (ruta === "/resumen") return Response.json(this.resumen());
    if (ruta === "/valor" && request.method === "GET") {
      const clave = new URL(request.url).searchParams.get("clave");
      const fila = this.sql.exec("SELECT valor FROM valores WHERE clave = ?", clave).toArray()[0];
      return Response.json({ valor: fila ? JSON.parse(fila.valor) : null });
    }
    if (ruta === "/valor" && request.method === "PUT") {
      const { clave, valor } = await request.json();
      this.sql.exec("INSERT INTO valores (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor", clave, JSON.stringify(valor));
      return Response.json({ ok: true });
    }
    return new Response("no encontrado", { status: 404 });
  }

  registrar({ claves = [], id, plataforma, version }) {
    const dia = hoy();
    for (const clave of claves.slice(0, 10)) {
      if (typeof clave !== "string" || clave.length > 60) continue;
      this.sql.exec("INSERT INTO contadores (dia, clave, n) VALUES (?, ?, 1) ON CONFLICT(dia, clave) DO UPDATE SET n = n + 1", dia, clave);
    }
    if (id) {
      if (this.diaVistos !== dia) {
        // Nuevo día: se vacía la caché y se borran activos viejos (retención limitada).
        this.diaVistos = dia;
        this.vistosHoy.clear();
        this.sql.exec("DELETE FROM activos WHERE dia < ?", haceDias(DIAS_RETENCION_ACTIVOS));
      }
      // Una escritura por instalación y día como mucho.
      if (!this.vistosHoy.has(id)) {
        this.vistosHoy.add(id);
        this.sql.exec("INSERT OR IGNORE INTO activos (dia, id) VALUES (?, ?)", dia, id);
        this.sql.exec(
          `INSERT INTO instalaciones (id, primera, ultima, plataforma, version) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET ultima = excluded.ultima, plataforma = excluded.plataforma, version = excluded.version`,
          id, dia, dia, plataforma, version,
        );
      }
    }
    return Response.json({ ok: true });
  }

  resumen() {
    const uno = (q, ...a) => this.sql.exec(q, ...a).toArray()[0] || {};
    const todos = (q, ...a) => this.sql.exec(q, ...a).toArray();
    const d7 = haceDias(6), d30 = haceDias(29), h = hoy();
    const suma = (clave, desde = "0000") => uno("SELECT COALESCE(SUM(n),0) AS n FROM contadores WHERE clave = ? AND dia >= ?", clave, desde).n;
    const porPrefijo = (prefijo, desde) =>
      Object.fromEntries(todos("SELECT substr(clave, ?) AS k, SUM(n) AS n FROM contadores WHERE clave LIKE ? AND dia >= ? GROUP BY clave ORDER BY n DESC", prefijo.length + 1, prefijo + "%", desde).map((r) => [r.k, r.n]));
    const activos = (desde) => uno("SELECT COUNT(DISTINCT id) AS n FROM activos WHERE dia >= ?", desde).n;

    const serie = todos(
      `SELECT d.dia, COALESCE(m.n,0) AS mensajes, COALESCE(a.n,0) AS activos FROM
         (SELECT DISTINCT dia FROM contadores WHERE dia >= ? UNION SELECT DISTINCT dia FROM activos WHERE dia >= ?) d
         LEFT JOIN (SELECT dia, SUM(n) AS n FROM contadores WHERE clave = 'mensajes' GROUP BY dia) m ON m.dia = d.dia
         LEFT JOIN (SELECT dia, COUNT(*) AS n FROM activos GROUP BY dia) a ON a.dia = d.dia
       ORDER BY d.dia`, d30, d30);

    return {
      generado: new Date().toISOString(),
      usuarios: {
        total: uno("SELECT COUNT(*) AS n FROM instalaciones").n,
        porPlataforma: Object.fromEntries(todos("SELECT plataforma AS k, COUNT(*) AS n FROM instalaciones GROUP BY plataforma").map((r) => [r.k, r.n])),
        nuevosHoy: uno("SELECT COUNT(*) AS n FROM instalaciones WHERE primera = ?", h).n,
        nuevos7: uno("SELECT COUNT(*) AS n FROM instalaciones WHERE primera >= ?", d7).n,
        activosHoy: activos(h),
        activos7: activos(d7),
        activos30: activos(d30),
        versiones: Object.fromEntries(todos("SELECT version AS k, COUNT(*) AS n FROM instalaciones WHERE ultima >= ? GROUP BY version ORDER BY n DESC", d30).map((r) => [r.k, r.n])),
      },
      mensajes: {
        hoy: suma("mensajes", h),
        dias7: suma("mensajes", d7),
        dias30: suma("mensajes", d30),
        total: suma("mensajes"),
        fallos30: suma("fallo", d30),
        invitado30: suma("invitado", d30),
        porModo30: porPrefijo("modo:", d30),
        porProveedor30: porPrefijo("proveedor:", d30),
        porPlataforma30: porPrefijo("plataforma:", d30),
        web30: porPrefijo("web:", d30),
      },
      eventos: { dias30: porPrefijo("evento:", d30), total: porPrefijo("evento:", "0000") },
      serie,
    };
  }
}
