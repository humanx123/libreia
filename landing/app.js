// LibreIA — landing. Sin dependencias, sin cookies, sin rastreadores.
// Lo único que pide fuera de este sitio es /v1/transparencia (cifras públicas y agregadas).
"use strict";
document.documentElement.classList.add("js");
const API = "https://libreia-api.libreia-chat-mobile.workers.dev/v1";
const SITE = location.origin + location.pathname.replace(/index\.html$/, "");
const $ = (id) => document.getElementById(id);

// ---------- mobile menu
const toggle = document.querySelector(".bar-toggle");
const nav = $("nav");
toggle.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  toggle.setAttribute("aria-expanded", String(open));
  toggle.textContent = open ? "CERRAR" : "MENÚ";
});
nav.addEventListener("click", (e) => {
  if (e.target.closest("a")) {
    nav.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = "MENÚ";
  }
});

// ---------- reveal on scroll
const io = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("on"); io.unobserve(en.target); } }), { threshold: 0.12 })
  : null;
document.querySelectorAll(".sec .h2, .versus, .manifesto li, .mode, .facts, .demo, .stats, .dl-card, .coin, .other-card, .mail").forEach((el) => {
  if (!io) return;
  el.classList.add("reveal");
  io.observe(el);
});

// ---------- live transparency
const fmt = (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("es"));
fetch(API + "/transparencia")
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
  .then((t) => {
    const set = (k, v) => { const el = document.querySelector(`[data-k="${k}"]`); if (el) el.textContent = v; };
    set("cuentas", fmt(t.cuentas));
    set("activos30", fmt(t.activos30));
    set("mensajesTotal", fmt(t.mensajesTotal));
    set("proveedores", fmt((t.proveedores || []).length));
    set("btc", t.donaciones?.btc ? String(t.donaciones.btc.recibido) : "—");
    set("usdc", t.donaciones?.usdc ? Number(t.donaciones.usdc.recibido).toFixed(2) : "—");
    const when = t.generado ? new Date(t.generado).toLocaleString("es") : "";
    $("statsNote").textContent = `Datos públicos de /v1/transparencia · actualizado ${when}. Proveedores: ${(t.proveedores || []).join(", ")}. ${t.privacidad || ""}`;
    if (t.donaciones?.nota) $("donNote").textContent = t.donaciones.nota + " Los importes recibidos se publican en la transparencia en vivo.";
  })
  .catch((e) => { $("statsNote").textContent = "No se pudieron cargar las cifras ahora mismo (" + e.message + "). Vuelve a intentarlo en un rato."; });

// ---------- privacy demo: same derivation as the app (src/api.ts), computed only here
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
$("demo").addEventListener("submit", async (e) => {
  e.preventDefault();
  // Igual que la app: Unicode normalizado (NFKC el correo, NFC la contraseña).
  const email = $("demoEmail").value.normalize("NFKC").trim().toLowerCase();
  const pass = $("demoPass").value.normalize("NFC");
  if (!email) { $("demoEmail").focus(); return; }
  if (!crypto?.subtle) { $("outEmail").textContent = "Tu navegador no permite WebCrypto en esta conexión."; return; }
  const enc = new TextEncoder();
  $("outPlain").textContent = email + (pass ? "  ·  " + "•".repeat(Math.min(pass.length, 24)) : "");
  $("outEmail").textContent = hex(await crypto.subtle.digest("SHA-256", enc.encode("libreia-correo:" + email)));
  if (pass) {
    $("outPass").textContent = "calculando 600 000 rondas…";
    // Igual que la app: 200 000 rondas y, encadenadas sobre ese resultado, otras 400 000.
    const pbkdf2 = async (raw, salt, iterations) => {
      const key = await crypto.subtle.importKey("raw", raw, "PBKDF2", false, ["deriveBits"]);
      return crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations, hash: "SHA-256" }, key, 256);
    };
    const v1 = await pbkdf2(enc.encode(pass), "libreia-clave:" + email, 200000);
    $("outPass").textContent = hex(await pbkdf2(v1, "libreia-clave2:" + email, 400000));
  } else {
    $("outPass").textContent = "— (escribe una contraseña para verlo)";
  }
});

// ---------- copy donation addresses
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.className = "skip";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  return ok;
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  const ok = await copy($(b.dataset.copy).textContent.trim());
  $("copyStatus").textContent = ok ? "✓ Dirección copiada. Revisa la red antes de enviar." : "No se pudo copiar: mantén pulsada la dirección para seleccionarla.";
  if (ok) { b.textContent = "Copiada ✓"; setTimeout(() => (b.textContent = "Copiar"), 1800); }
});

// ---------- share
$("shareBtn").addEventListener("click", async () => {
  const text = "LibreIA: inteligencia artificial libre, neutral y de la comunidad. Gratis, sin anuncios y sin guardar tus chats.";
  try {
    if (navigator.share) { await navigator.share({ title: "LibreIA", text, url: SITE }); return; }
    await copy(text + " " + SITE);
    $("shareLabel").textContent = "✓ Enlace copiado";
  } catch { /* cancelled */ }
});
