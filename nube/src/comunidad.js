// Cuentas y comunidad de LibreIA (Durable Object con SQLite, plan gratuito).
//
// Privacidad de las cuentas:
//   · La app NUNCA envía el correo ni la contraseña en claro. Envía:
//       correoHash = SHA-256("libreia-correo:" + correo)
//       clave      = PBKDF2(contraseña, "libreia-clave:" + correo, 200 000 iteraciones)
//   · Aquí solo se guarda HMAC(pepper, …) de esos valores: ni el correo ni la contraseña
//     se pueden leer, tampoco con acceso a la base de datos. Por eso no hay recuperación.
//   · No se guardan chats, mensajes, IPs ni nombres.
//
// Comunidad: propuestas y votos (una cuenta, un voto por propuesta).

const ESTADOS = ["abierta", "en_curso", "hecha", "descartada"];
const MAX_PROPUESTAS_DIA = 3;
const hoy = () => new Date().toISOString().slice(0, 10);

export class Comunidad {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS cuentas (id TEXT PRIMARY KEY, verificador TEXT NOT NULL, creada TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS propuestas (id INTEGER PRIMARY KEY AUTOINCREMENT, autor TEXT, titulo TEXT NOT NULL, texto TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'abierta', creada TEXT NOT NULL, respuesta TEXT);
      CREATE TABLE IF NOT EXISTS votos (propuesta INTEGER NOT NULL, cuenta TEXT NOT NULL, PRIMARY KEY (propuesta, cuenta));
    `);
  }

  uno(q, ...a) {
    return this.sql.exec(q, ...a).toArray()[0] || null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const ruta = url.pathname;
    const datos = request.method === "GET" ? Object.fromEntries(url.searchParams) : await request.json().catch(() => ({}));
    const r = (cuerpo, estado = 200) => Response.json(cuerpo, { status: estado });

    // ---- cuentas
    if (ruta === "/cuentas/registrar") {
      if (this.uno("SELECT id FROM cuentas WHERE id = ?", datos.id)) return r({ error: "Ya existe una cuenta con ese correo" }, 409);
      this.sql.exec("INSERT INTO cuentas (id, verificador, creada) VALUES (?, ?, ?)", datos.id, datos.verificador, hoy());
      return r({ ok: true });
    }
    if (ruta === "/cuentas/verificar") {
      const c = this.uno("SELECT verificador FROM cuentas WHERE id = ?", datos.id);
      return r({ ok: !!c && igual(c.verificador, datos.verificador), existe: !!c });
    }
    if (ruta === "/cuentas/existe") {
      return r({ ok: !!this.uno("SELECT id FROM cuentas WHERE id = ?", datos.id) });
    }
    if (ruta === "/cuentas/cambiar") {
      const c = this.uno("SELECT verificador FROM cuentas WHERE id = ?", datos.id);
      if (!c || !igual(c.verificador, datos.verificadorActual)) return r({ error: "La contraseña actual no es correcta" }, 401);
      this.sql.exec("UPDATE cuentas SET verificador = ? WHERE id = ?", datos.verificadorNuevo, datos.id);
      return r({ ok: true });
    }
    if (ruta === "/cuentas/borrar") {
      const c = this.uno("SELECT verificador FROM cuentas WHERE id = ?", datos.id);
      if (!c || !igual(c.verificador, datos.verificador)) return r({ error: "La contraseña no es correcta" }, 401);
      // Se borra la cuenta y sus votos; sus propuestas quedan sin autor (siguen siendo de la comunidad).
      this.sql.exec("DELETE FROM votos WHERE cuenta = ?", datos.id);
      this.sql.exec("UPDATE propuestas SET autor = NULL WHERE autor = ?", datos.id);
      this.sql.exec("DELETE FROM cuentas WHERE id = ?", datos.id);
      return r({ ok: true });
    }
    if (ruta === "/cuentas/contar") {
      return r({
        total: this.uno("SELECT COUNT(*) AS n FROM cuentas").n,
        hoy: this.uno("SELECT COUNT(*) AS n FROM cuentas WHERE creada = ?", hoy()).n,
      });
    }

    // ---- propuestas
    if (ruta === "/propuestas" && request.method === "GET") {
      const cuenta = datos.cuenta || "";
      const lista = this.sql
        .exec(
          `SELECT p.id, p.titulo, p.texto, p.estado, p.creada, p.respuesta,
                  (SELECT COUNT(*) FROM votos v WHERE v.propuesta = p.id) AS votos,
                  EXISTS(SELECT 1 FROM votos v WHERE v.propuesta = p.id AND v.cuenta = ?) AS mio,
                  (p.autor IS NOT NULL AND p.autor = ?) AS propia
           FROM propuestas p ORDER BY (p.estado IN ('hecha','descartada')), votos DESC, p.id DESC LIMIT 200`,
          cuenta, cuenta,
        )
        .toArray()
        .map((p) => ({ ...p, mio: !!p.mio, propia: !!p.propia }));
      return r({ propuestas: lista });
    }
    if (ruta === "/propuestas" && request.method === "POST") {
      const titulo = limpiar(datos.titulo, 120);
      const texto = limpiar(datos.texto, 1000);
      if (titulo.length < 6) return r({ error: "El título debe tener al menos 6 caracteres" }, 400);
      if (!this.uno("SELECT id FROM cuentas WHERE id = ?", datos.cuenta)) return r({ error: "Cuenta no encontrada" }, 401);
      const hechas = this.uno("SELECT COUNT(*) AS n FROM propuestas WHERE autor = ? AND creada = ?", datos.cuenta, hoy()).n;
      if (hechas >= MAX_PROPUESTAS_DIA) return r({ error: `Máximo ${MAX_PROPUESTAS_DIA} propuestas por día` }, 429);
      this.sql.exec("INSERT INTO propuestas (autor, titulo, texto, creada) VALUES (?, ?, ?, ?)", datos.cuenta, titulo, texto, hoy());
      const id = this.uno("SELECT last_insert_rowid() AS id").id;
      this.sql.exec("INSERT OR IGNORE INTO votos (propuesta, cuenta) VALUES (?, ?)", id, datos.cuenta);
      return r({ ok: true, id });
    }
    if (ruta === "/propuestas/votar") {
      const id = Number(datos.propuesta);
      if (!this.uno("SELECT id FROM propuestas WHERE id = ?", id)) return r({ error: "La propuesta no existe" }, 404);
      if (!this.uno("SELECT id FROM cuentas WHERE id = ?", datos.cuenta)) return r({ error: "Cuenta no encontrada" }, 401);
      const ya = this.uno("SELECT 1 AS x FROM votos WHERE propuesta = ? AND cuenta = ?", id, datos.cuenta);
      if (ya) this.sql.exec("DELETE FROM votos WHERE propuesta = ? AND cuenta = ?", id, datos.cuenta);
      else this.sql.exec("INSERT INTO votos (propuesta, cuenta) VALUES (?, ?)", id, datos.cuenta);
      return r({ ok: true, mio: !ya });
    }
    // Moderación (solo desde el panel de administración).
    if (ruta === "/propuestas/estado") {
      if (!ESTADOS.includes(datos.estado)) return r({ error: "Estado inválido" }, 400);
      this.sql.exec("UPDATE propuestas SET estado = ?, respuesta = ? WHERE id = ?", datos.estado, limpiar(datos.respuesta, 500) || null, Number(datos.propuesta));
      return r({ ok: true });
    }
    if (ruta === "/propuestas/borrar") {
      this.sql.exec("DELETE FROM votos WHERE propuesta = ?", Number(datos.propuesta));
      this.sql.exec("DELETE FROM propuestas WHERE id = ?", Number(datos.propuesta));
      return r({ ok: true });
    }
    return r({ error: "no encontrado" }, 404);
  }
}

function limpiar(t, max) {
  return String(t || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function igual(a, b) {
  const x = String(a), y = String(b || "");
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return d === 0;
}
