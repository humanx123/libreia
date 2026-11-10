// Static content: what LibreIA is, the manifesto and the privacy promise.
// Every claim here must stay true to how the code actually works.

export const REPO_URL = "https://github.com/humanx123/libreia";
export const CONTACT_EMAIL = "libreia@proton.me";
// Volunteer node connector (served with the web app and the API).
export const NODE_SCRIPT_URL = "https://libreia-api.libreia-chat-mobile.workers.dev/nodo/libreia-nodo.mjs";

export const PRIVACY_POINTS = `
<ul class="privacy-list">
  <li><b>Tu correo y tu contraseña no salen de tu dispositivo.</b> Se transforman aquí en huellas (la contraseña, con 600 000 rondas de PBKDF2). El servidor las vuelve a cifrar con una clave secreta y solo guarda ese resultado.</li>
  <li><b>Tus chats viven solo en este dispositivo.</b> No se guardan en ningún servidor. Puedes exportarlos o borrarlos en Configuración.</li>
  <li><b>No guardamos</b> tu IP, tu nombre ni lo que escribes. Solo contamos números agregados (cuántos usuarios y mensajes) y puedes desactivarlo.</li>
  <li><b>Cuando marcas si una fuente es real,</b> el servidor guarda solo el dominio (por ejemplo, «wikipedia.org») y tu veredicto, con huellas irreversibles para contar personas distintas. Nunca guarda la página junto a quién votó. Con esos votos, los dominios que la comunidad marca como falsos dejan de usarse en las búsquedas.</li>
  <li><b>El correo es solo tu nombre de usuario:</b> no lo verificamos ni te escribiremos nunca.</li>
  <li><b>Quién lee cada mensaje para responderlo:</b> el proveedor del modelo (o el de tu propia clave, si la usas). En el modo <b>Comunidad</b> lo lee el ordenador de un voluntario, que podría verlo: no lo uses para datos personales.</li>
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
    <div class="hero-logo" aria-hidden="true">LIBRE<b>IA</b></div>
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
      <li><b>Verdad verificable.</b> Citamos fuentes reales, tú marcas si lo son, y mostramos qué modelo respondió cada mensaje.</li>
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
    <h2>Suma cómputo: IA hecha por personas</h2>
    <p><b>🔑 Trae tu propia clave.</b> Si tienes una clave gratuita de Groq, Google AI Studio, OpenRouter u otro proveedor,
      ponla en <button type="button" class="link-btn inline" data-open-settings>Configuración</button>. Tus mensajes irán con tu clave y
      el cupo común quedará para quien no tiene. La clave es solo tuya: se guarda cifrada en tu dispositivo y no se comparte.</p>
    <p><b>🧪 Modo Comunidad (experimental).</b> Elige «Comunidad» en el selector de modo y te responderá un modelo abierto que
      corre en el ordenador de un voluntario de la red <a href="https://aihorde.net" target="_blank" rel="noopener noreferrer" data-external>AI Horde</a>.
      Es más lento y el voluntario puede ver los mensajes: no lo uses para datos personales.</p>
    <p><b>💻 Presta tu ordenador.</b> Con una tarjeta gráfica (o incluso solo el procesador, con modelos pequeños) puedes servir modelos a
      todo el mundo: instala <a href="https://github.com/LostRuins/koboldcpp" target="_blank" rel="noopener noreferrer" data-external>KoboldCpp</a>,
      carga un modelo instruct (Gemma, Qwen o Llama) y actívalo como trabajador de AI Horde. Cada respuesta que das suma
      «kudos», que dan prioridad a quien los tiene.</p>
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
