// Configuración viva del motor de IA. La escribe el panel de administración
// (Worker libreia-admin) en el KV CONFIG; este Worker la lee y la guarda en memoria
// del isolate unos segundos para no leer KV en cada petición.
//
//   motor:catalogo  → catálogo de proveedores y modos (JSON). Si falta, se usa catalogo.js.
//   motor:ajustes   → límite por minuto, mantenimiento, instrucciones de sistema por modo.
//   motor:claves    → claves de proveedores cifradas con MASTER_KEY. Tienen prioridad
//                     sobre los secretos KEY_* del Worker.

import { CATALOGO } from "./catalogo.js";
import { descifrar } from "./cifrado.js";

export const AJUSTES_POR_DEFECTO = {
  limitePorMinuto: 20,
  mantenimiento: false,
  mensajeMantenimiento: "LibreIA está en mantenimiento. Vuelve a intentarlo en unos minutos.",
  sistema: {},
  busquedaWeb: true,
  requerirCuenta: true,
  invitados: true,
  captchaRegistro: true,
  mensajesInvitado: 10,
  mensajesDiaCuenta: 300,
  resultadosWeb: 5,
};

const TTL_MS = 30000;
let cache = null;
let ultimoBueno = null;

export function invalidarMotor() {
  cache = null;
}

export async function cargarMotor(env) {
  if (cache && Date.now() - cache.t < TTL_MS) return cache.motor;

  const clavesSecretos = Object.fromEntries(Object.entries(env).filter(([k, v]) => k.startsWith("KEY_") && typeof v === "string" && v));
  let catalogo = CATALOGO;
  let ajustes = { ...AJUSTES_POR_DEFECTO };
  let clavesPanel = {};
  let personalizado = false;
  const avisos = [];

  try {
    const [cat, aj, cl] = await Promise.all([
      env.CONFIG.get("motor:catalogo", "json"),
      env.CONFIG.get("motor:ajustes", "json"),
      env.CONFIG.get("motor:claves"),
    ]);
    if (cat?.providers && cat?.modes && cat?.fusion) {
      catalogo = cat;
      personalizado = true;
    }
    if (aj) ajustes = { ...AJUSTES_POR_DEFECTO, ...aj, sistema: { ...(aj.sistema || {}) } };
    if (cl) {
      if (!env.MASTER_KEY) avisos.push("Hay claves del panel pero falta MASTER_KEY para descifrarlas");
      else clavesPanel = await descifrar(env.MASTER_KEY, cl);
    }
  } catch (e) {
    // Si ya hubo una configuración buena en este isolate, se sigue usando (mantenimiento, límites e
    // instrucciones no vuelven a los de fábrica por un fallo pasajero del KV). El fallo queda visible.
    avisos.push(`No se pudo leer la configuración del panel: ${e.message}`);
    console.error("cargarMotor:", e);
    if (ultimoBueno) {
      ({ catalogo, ajustes, personalizado } = ultimoBueno);
      clavesPanel = ultimoBueno.clavesPanel;
    }
  }
  if (!avisos.length) ultimoBueno = { catalogo, ajustes, personalizado, clavesPanel };

  const origen = {};
  for (const k of Object.keys(clavesSecretos)) origen[k] = "secreto";
  for (const k of Object.keys(clavesPanel)) origen[k] = "panel";

  const motor = { catalogo, ajustes, claves: { ...clavesSecretos, ...clavesPanel }, origen, personalizado, avisos };
  // Con avisos se cachea menos tiempo para recuperarse pronto.
  cache = { t: avisos.length ? Date.now() - TTL_MS + 5000 : Date.now(), motor };
  return motor;
}
