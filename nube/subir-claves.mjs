// Sube las claves PROPIAS de LibreIA (cuentas aisladas, separadas de las personales)
// como secretos del Worker. Antes de subir cada clave hace una petición mínima al
// proveedor; si la clave no responde, NO se sube y el secreto actual queda intacto.
//
// Uso:
//   1. Crear /root/.config/libreia/claves.env (chmod 600) con líneas KEY_GROQ=..., KEY_NVIDIA=..., etc.
//   2. node nube/subir-claves.mjs [/ruta/claves.env]
// Nunca imprime los valores de las claves.

import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { CATALOGO } from "./src/catalogo.js";

const archivo = process.argv[2] || "/root/.config/libreia/claves.env";
const claves = Object.fromEntries(
  fs.readFileSync(archivo, "utf8").split("\n")
    .map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);

// Primer modelo del catálogo de cada proveedor, para la prueba.
const modelos = {};
for (const d of [...Object.values(CATALOGO.modes).flat(), ...CATALOGO.fusion.panel]) modelos[d.platform] ??= d.model;

const validas = {};
for (const [platform, p] of Object.entries(CATALOGO.providers)) {
  if (!p.secretName || !claves[p.secretName]) continue;
  try {
    const res = await fetch(p.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${claves[p.secretName]}` },
      body: JSON.stringify({ model: modelos[platform], messages: [{ role: "user", content: "Responde solo: OK" }], max_tokens: 64 }),
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) {
      validas[p.secretName] = claves[p.secretName];
      console.log(`✔ ${p.secretName}: válida (${modelos[platform]})`);
    } else {
      console.log(`✘ ${p.secretName}: HTTP ${res.status}, no se sube`);
    }
  } catch (e) {
    console.log(`✘ ${p.secretName}: ${e.message}, no se sube`);
  }
}
const desconocidas = Object.keys(claves).filter((k) => !Object.values(CATALOGO.providers).some((p) => p.secretName === k));
if (desconocidas.length) console.log("Ignoradas (no están en el catálogo):", desconocidas.join(", "));

if (!Object.keys(validas).length) {
  console.log("No hay claves válidas: no se cambió nada.");
  process.exit(1);
}
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "libreia-")), "s.json");
fs.writeFileSync(tmp, JSON.stringify(validas), { mode: 0o600 });
try {
  execFileSync("npx", ["wrangler", "secret", "bulk", tmp], { stdio: "inherit", cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), "..") });
} finally {
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
}
console.log(`Listo: ${Object.keys(validas).length} clave(s) aisladas de LibreIA activas.`);
