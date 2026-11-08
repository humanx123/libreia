// Cuentas y comunidad de LibreIA (Durable Object con SQLite, plan gratuito).
//
// Privacidad de las cuentas:
//   · La app NUNCA envía el correo ni la contraseña en claro. Envía:
//       correoHash = SHA-256("libreia-correo:" + correo)
//       clave      = PBKDF2(contraseña, "libreia-clave:" + correo, 200 000 iteraciones)   (kdf 1)
//       clave2     = PBKDF2(clave, "libreia-clave2:" + correo, 400 000 iteraciones)      (kdf 2: 600 000 en total)
//     Las cuentas kdf 1 pasan solas a kdf 2 la próxima vez que entran con una app actual
//     (la app manda las dos claves; la de kdf 1 solo se acepta mientras la cuenta siga en kdf 1).
//   · Aquí solo se guarda HMAC(pepper, …) de esos valores: ni el correo ni la contraseña
//     se pueden leer, tampoco con acceso a la base de datos. Por eso no hay recuperación.
//   · No se guardan chats, mensajes, IPs ni nombres.
//
// Comunidad: propuestas y votos (una cuenta, un voto por propuesta).

const ESTADOS = ["abierta", "en_curso", "hecha", "descartada"];
const MAX_PROPUESTAS_DIA = 3;
const ACTUALIZAR = "Tu cuenta ya usa la protección reforzada de contraseña. Actualiza la app (o entra desde la web) para continuar.";
const hoy = () => new Date().toISOString().slice(0, 10);

export class Comunidad {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS cuentas (id TEXT PRIMARY KEY, verificador TEXT NOT NULL, creada TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS propuestas (id INTEGER PRIMARY KEY AUTOINCREMENT, autor TEXT, titulo TEXT NOT NULL, texto TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'abierta', creada TEXT NOT NULL, respuesta TEXT);
      CREATE TABLE IF NOT EXISTS votos (propuesta INTEGER NOT NULL, cuenta TEXT NOT NULL, PRIMARY KEY (propuesta, cuenta));
      CREATE INDEX IF NOT EXISTS iv_cuenta ON votos(cuenta);
      CREATE INDEX IF NOT EXISTS ip_autor ON propuestas(autor, creada);
    `);
    // Versión de la cuenta: sube al cambiar la contraseña, y las sesiones anteriores dejan de valer.
    try {
      this.sql.exec("ALTER TABLE cuentas ADD COLUMN ver INTEGER NOT NULL DEFAULT 0");
    } catch {
      /* la columna ya existe */
    }
    // Derivación de la contraseña: 1 = 200 000 rondas de PBKDF2; 2 = 600 000.
    try {
      this.sql.exec("ALTER TABLE cuentas ADD COLUMN kdf INTEGER NOT NULL DEFAULT 1");
    } catch {
      /* la columna ya existe */
    }
    this.cacheLista = null; // lista de propuestas (sin datos de cuentas), 30 s
  }

  uno(q, ...a) {
    return this.sql.exec(q, ...a).toArray()[0] || null;
  }

  /**
   * Comprueba la contraseña de una cuenta. `d` trae el verificador en su kdf y, si es kdf 2,
   * opcionalmente el de kdf 1 (`anterior`). Si la cuenta sigue en kdf 1 y la contraseña es
   * correcta, se mejora a kdf 2 en el momento. Una cuenta ya en kdf 2 nunca acepta el de kdf 1.
   */
  comprobar(id, d) {
    const c = this.uno("SELECT verificador, kdf, ver FROM cuentas WHERE id = ?", id);
    if (!c) return { ok: false };
    const kdf = d?.kdf === 2 ? 2 : 1;
    if (c.kdf >= 2) {
      if (kdf !== 2) return { ok: false, actualizar: true };
      return { ok: igual(c.verificador, d.verificador), ver: c.ver };
    }
    const v1 = kdf === 2 ? d.anterior : d.verificador;
    if (!igual(c.verificador, v1)) return { ok: false };
    if (kdf === 2 && validoHex(d.verificador, 64)) this.sql.exec("UPDATE cuentas SET verificador = ?, kdf = 2 WHERE id = ?", d.verificador, id);
    return { ok: true, ver: c.ver };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const ruta = url.pathname;
    const datos = request.method === "GET" ? Object.fromEntries(url.searchParams) : await request.json().catch(() => ({}));
    const r = (cuerpo, estado = 200) => Response.json(cuerpo, { status: estado });

    // ---- cuentas
    if (ruta === "/cuentas/registrar") {
      if (!validoHex(datos.id, 32) || !validoHex(datos.verificador, 64)) return r({ error: "Datos inválidos" }, 400);
      // Mensaje genérico: no confirma a terceros si un correo tiene cuenta.
      if (this.uno("SELECT id FROM cuentas WHERE id = ?", datos.id)) return r({ error: "No se pudo crear la cuenta. Si ya tienes una con ese correo, usa «Entrar»." }, 409);
      this.sql.exec("INSERT INTO cuentas (id, verificador, creada, kdf) VALUES (?, ?, ?, ?)", datos.id, datos.verificador, hoy(), datos.kdf === 2 ? 2 : 1);
      return r({ ok: true });
    }
    if (ruta === "/cuentas/verificar") {
      const c = this.comprobar(datos.id, datos);
      return r({ ok: c.ok, ver: c.ok ? c.ver : undefined, actualizar: c.actualizar || undefined });
    }
    if (ruta === "/cuentas/salir") {
      // Cerrar sesión en todos los dispositivos: sube la versión y las sesiones emitidas dejan de valer.
      this.sql.exec("UPDATE cuentas SET ver = ver + 1 WHERE id = ?", datos.id);
      return r({ ok: true });
    }
    if (ruta === "/cuentas/version") {
      const c = this.uno("SELECT ver FROM cuentas WHERE id = ?", datos.id);
      return r({ ver: c ? c.ver : null });
    }
    if (ruta === "/cuentas/existe") {
      return r({ ok: !!this.uno("SELECT id FROM cuentas WHERE id = ?", datos.id) });
    }
    if (ruta === "/cuentas/cambiar") {
      if (!validoHex(datos.nuevo?.verificador, 64)) return r({ error: "Datos inválidos" }, 400);
      const c = this.comprobar(datos.id, datos.actual);
      if (c.actualizar) return r({ error: ACTUALIZAR, actualizar: true }, 426);
      if (!c.ok) return r({ error: "La contraseña actual no es correcta" }, 401);
      this.sql.exec("UPDATE cuentas SET verificador = ?, kdf = ?, ver = ver + 1 WHERE id = ?", datos.nuevo.verificador, datos.nuevo.kdf === 2 ? 2 : 1, datos.id);
      return r({ ok: true, ver: this.uno("SELECT ver FROM cuentas WHERE id = ?", datos.id).ver });
    }
    if (ruta === "/cuentas/borrar") {
      const c = this.comprobar(datos.id, datos);
      if (c.actualizar) return r({ error: ACTUALIZAR, actualizar: true }, 426);
      if (!c.ok) return r({ error: "La contraseña no es correcta" }, 401);
      // Se borra la cuenta y sus votos; sus propuestas quedan sin autor (siguen siendo de la comunidad).
      this.sql.exec("DELETE FROM votos WHERE cuenta = ?", datos.id);
      this.sql.exec("UPDATE propuestas SET autor = NULL WHERE autor = ?", datos.id);
      this.sql.exec("DELETE FROM cuentas WHERE id = ?", datos.id);
      this.cacheLista = null;
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
      const cuenta = typeof datos.cuenta === "string" ? datos.cuenta : "";
      // La lista común se calcula como mucho cada 30 s (leer todo en cada visita agotaría la cuota de lecturas).
      if (!this.cacheLista || Date.now() - this.cacheLista.t > 30000) {
        this.cacheLista = {
          t: Date.now(),
          filas: this.sql
            .exec(
              `SELECT p.id, p.titulo, p.texto, p.estado, p.creada, p.respuesta, p.autor,
                      (SELECT COUNT(*) FROM votos v WHERE v.propuesta = p.id) AS votos
               FROM propuestas p ORDER BY (p.estado IN ('hecha','descartada')), votos DESC, p.id DESC LIMIT 200`,
            )
            .toArray(),
        };
      }
      const misVotos = cuenta ? new Set(this.sql.exec("SELECT propuesta FROM votos WHERE cuenta = ?", cuenta).toArray().map((v) => v.propuesta)) : new Set();
      const lista = this.cacheLista.filas.map(({ autor, ...p }) => ({ ...p, mio: misVotos.has(p.id), propia: !!cuenta && autor === cuenta }));
      return r({ propuestas: lista });
    }
    if (ruta === "/propuestas" && request.method === "POST") {
      if (typeof datos.titulo !== "string" || (datos.texto != null && typeof datos.texto !== "string")) return r({ error: "Datos inválidos" }, 400);
      const titulo = limpiar(datos.titulo, 120);
      const texto = limpiar(datos.texto, 1000);
      if (titulo.length < 6) return r({ error: "El título debe tener al menos 6 caracteres" }, 400);
      if (!this.uno("SELECT id FROM cuentas WHERE id = ?", datos.cuenta)) return r({ error: "Cuenta no encontrada" }, 401);
      const hechas = this.uno("SELECT COUNT(*) AS n FROM propuestas WHERE autor = ? AND creada = ?", datos.cuenta, hoy()).n;
      if (hechas >= MAX_PROPUESTAS_DIA) return r({ error: `Máximo ${MAX_PROPUESTAS_DIA} propuestas por día` }, 429);
      this.sql.exec("INSERT INTO propuestas (autor, titulo, texto, creada) VALUES (?, ?, ?, ?)", datos.cuenta, titulo, texto, hoy());
      const id = this.uno("SELECT last_insert_rowid() AS id").id;
      this.sql.exec("INSERT OR IGNORE INTO votos (propuesta, cuenta) VALUES (?, ?)", id, datos.cuenta);
      this.cacheLista = null;
      return r({ ok: true, id });
    }
    if (ruta === "/propuestas/votar") {
      const id = Number(datos.propuesta);
      if (!Number.isSafeInteger(id) || id <= 0) return r({ error: "Propuesta inválida" }, 400);
      if (!this.uno("SELECT id FROM propuestas WHERE id = ?", id)) return r({ error: "La propuesta no existe" }, 404);
      if (!this.uno("SELECT id FROM cuentas WHERE id = ?", datos.cuenta)) return r({ error: "Cuenta no encontrada" }, 401);
      const ya = this.uno("SELECT 1 AS x FROM votos WHERE propuesta = ? AND cuenta = ?", id, datos.cuenta);
      if (ya) this.sql.exec("DELETE FROM votos WHERE propuesta = ? AND cuenta = ?", id, datos.cuenta);
      else this.sql.exec("INSERT INTO votos (propuesta, cuenta) VALUES (?, ?)", id, datos.cuenta);
      this.cacheLista = null;
      return r({ ok: true, mio: !ya });
    }
    // Moderación (solo desde el panel de administración).
    if (ruta === "/propuestas/estado") {
      if (!ESTADOS.includes(datos.estado)) return r({ error: "Estado inválido" }, 400);
      this.sql.exec("UPDATE propuestas SET estado = ?, respuesta = ? WHERE id = ?", datos.estado, limpiar(datos.respuesta, 500) || null, Number(datos.propuesta));
      this.cacheLista = null;
      return r({ ok: true });
    }
    if (ruta === "/propuestas/borrar") {
      this.sql.exec("DELETE FROM votos WHERE propuesta = ?", Number(datos.propuesta));
      this.sql.exec("DELETE FROM propuestas WHERE id = ?", Number(datos.propuesta));
      this.cacheLista = null;
      return r({ ok: true });
    }
    return r({ error: "no encontrado" }, 404);
  }
}

const validoHex = (v, n) => typeof v === "string" && v.length === n && /^[0-9a-f]+$/.test(v);

function limpiar(t, max) {
  return String(t || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function igual(a, b) {
  const x = String(a), y = String(b || "");
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return d === 0;
}
