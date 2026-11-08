// Aplica la piel y el modo guardados ANTES de pintar la página (evita un destello del tema por defecto).
// Se carga como script normal en <head>; el resto de la lógica está en src/main.ts.
(function () {
  var piel = "pancarta", modo = "oscuro";
  try {
    var a = JSON.parse(localStorage.getItem("libreia.apariencia") || "{}");
    if (a.piel === "ateneo" || a.piel === "laboratorio") piel = a.piel;
    if (a.modo === "claro") modo = "claro";
  } catch (e) {
    /* sin almacenamiento: tema por defecto */
  }
  document.documentElement.setAttribute("data-piel", piel);
  document.documentElement.setAttribute("data-modo", modo);
})();
