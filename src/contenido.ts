// Static content: what LibreIA is, the manifesto and the privacy promise.
// Every claim here must stay true to how the code actually works.

export const REPO_URL = "https://github.com/humanx123/libreia";
export const CONTACT_EMAIL = "libreia@proton.me";

export const PRIVACY_POINTS = `
<ul class="privacy-list">
  <li><b>Tu correo y tu contraseña no salen de tu dispositivo.</b> Se transforman aquí en huellas cifradas irreversibles; el servidor solo guarda esas huellas.</li>
  <li><b>Tus chats viven solo en este dispositivo.</b> No se guardan en ningún servidor. Puedes exportarlos o borrarlos en Configuración.</li>
  <li><b>No guardamos</b> tu IP, tu nombre ni lo que escribes. Solo contamos números agregados (cuántos usuarios y mensajes) y puedes desactivarlo.</li>
  <li><b>El correo es solo tu nombre de usuario:</b> no lo verificamos ni te escribiremos nunca.</li>
</ul>`;

export const RECOVERY_WARNING = `
<div class="warning-box">
  <b>⚠️ Guarda bien tu contraseña.</b> Como no conocemos tu correo ni tu contraseña, <b>no se pueden recuperar</b>:
  no existe «olvidé mi contraseña». Si la pierdes, tendrás que crear otra cuenta (tus chats siguen en este dispositivo).
</div>`;

export const ABOUT_HTML = `
<div class="page-inner">
  <button class="back-btn" data-back type="button">← Volver al chat</button>

  <section class="hero">
    <img src="/libreia-logo.png" alt="" class="hero-logo">
    <p class="hero-kicker">// Manifiesto · código abierto · AGPL-3.0</p>
    <h1 class="hero-title"><span>La IA es</span><span class="struck">propiedad privada</span><span class="hl">bien común.</span></h1>
    <p class="hero-sub"><b>LibreIA</b>: inteligencia artificial libre, neutral y gobernada por su comunidad. Más en
      <a href="https://libreia.pages.dev" target="_blank" rel="noopener noreferrer" data-external>libreia.pages.dev</a>.</p>
  </section>

  <section class="about-block">
    <h2>¿Qué es LibreIA?</h2>
    <p>LibreIA es un chat de inteligencia artificial <b>gratuito</b> que une varios modelos abiertos y gratuitos de distintos proveedores. Si uno falla, responde otro; y en el modo <b>Fusión</b>, varios modelos contestan a la vez y se combina lo mejor de cada uno.</p>
    <p>Antes de responder, LibreIA <b>busca en la web</b> y cita las fuentes que consultó, para que puedas comprobar cada dato.</p>
    <div class="modes-grid">
      <div><b>Neutral</b><span>Presenta los distintos puntos de vista con sus mejores argumentos.</span></div>
      <div><b>Libre</b><span>Directo y franco, sin sermones: trata a las personas como adultas.</span></div>
      <div><b>Técnico</b><span>Código y soluciones de ingeniería.</span></div>
      <div><b>Fusión</b><span>Varios modelos a la vez, combinados en una sola respuesta.</span></div>
    </div>
  </section>

  <section class="about-block manifesto">
    <h2>Manifiesto</h2>
    <ol>
      <li><b>Acceso universal.</b> La inteligencia artificial es conocimiento común. LibreIA es gratis, sin publicidad y sin vender datos.</li>
      <li><b>Privacidad por diseño.</b> Lo que no se guarda no se puede filtrar, vender ni entregar. Tus chats son tuyos y viven en tu dispositivo.</li>
      <li><b>Neutralidad y pluralidad.</b> No imponemos una ideología: mostramos los argumentos y tú decides.</li>
      <li><b>Libertad con responsabilidad.</b> Hablamos con franqueza y sin moralina; la responsabilidad de cómo se usa la información es de cada persona adulta.</li>
      <li><b>Verdad verificable.</b> Citamos fuentes reales y mostramos qué modelo respondió cada mensaje.</li>
      <li><b>Transparencia radical.</b> Las cifras de uso y de donaciones son públicas para todos.</li>
      <li><b>Gobierno de la comunidad.</b> Quien usa LibreIA propone y vota el rumbo del proyecto: una cuenta, un voto.</li>
      <li><b>Soberanía de los datos.</b> Exporta, importa o borra tus chats y tu cuenta cuando quieras, sin pedir permiso.</li>
      <li><b>Sostenibilidad voluntaria.</b> Se mantiene con donaciones libres, no con suscripciones obligatorias ni con tu información.</li>
      <li><b>Código libre.</b> Todo el código es público bajo licencia AGPL-3.0: cualquiera puede revisarlo, mejorarlo o montar su propia LibreIA.</li>
    </ol>
  </section>

  <section class="about-block">
    <h2>Tu privacidad, en concreto</h2>
    ${PRIVACY_POINTS}
  </section>

  <section class="about-block">
    <h2>Transparencia en vivo</h2>
    <div id="transparency" class="transparency-grid"><p class="muted">Cargando cifras públicas…</p></div>
    <p class="muted small">Cifras agregadas y anónimas, actualizadas cada pocos minutos. Cualquiera puede consultarlas.</p>
  </section>

  <section class="about-block">
    <h2>Cómo apoyar</h2>
    <div class="support-actions">
      <button type="button" class="primary" data-open-support>♥ Donar (cripto)</button>
      <button type="button" data-go="community">🗳 Proponer y votar mejoras</button>
      <button type="button" data-share>↗ Compartir LibreIA</button>
    </div>
    <p class="muted">Las donaciones son voluntarias y pagan servidores y modelos mejores para todas las personas.
      ¿Quieres donar por otro medio? Escríbenos a <a href="mailto:${CONTACT_EMAIL}?subject=Donaci%C3%B3n%20a%20LibreIA">${CONTACT_EMAIL}</a>.</p>
  </section>

  <section class="about-block">
    <h2>Contribuir</h2>
    <p>LibreIA es <b>software libre</b> (AGPL-3.0). El código completo está en
      <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer" data-external>${REPO_URL.replace("https://", "")}</a>:
      puedes revisarlo, proponer cambios o desplegar tu propia instancia gratis en Cloudflare.
      Comparte el sitio <a href="https://libreia.pages.dev" target="_blank" rel="noopener noreferrer" data-external>libreia.pages.dev</a>.</p>
    <p>¿Quieres aportar código, ideas, traducciones, difusión o recursos? Escríbenos a
      <a href="mailto:${CONTACT_EMAIL}?subject=Quiero%20contribuir%20a%20LibreIA">${CONTACT_EMAIL}</a>
      o deja tu propuesta en la <button type="button" class="link-btn inline" data-go="community">Comunidad</button>.</p>
  </section>

  <button class="back-btn bottom" data-back type="button">← Volver al chat</button>
  <p class="signature">Hecho xhumanx + IA</p>
</div>`;
