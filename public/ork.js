/**
 * Ork — snippet embebible para el checkout del comercio.
 *
 * Uso:
 *   <div data-ork data-merchant="sokolateria" data-plan="mensual"></div>
 *   <script src="https://ork.mx/ork.js" async></script>
 *
 * O a mano:
 *   Ork.mount(document.querySelector('#donde'), { merchant: 'x', plan: 'y' })
 *
 * Principios:
 *  - Shadow DOM: los estilos del comercio no entran y los de Ork no salen.
 *  - Falla en silencio: si algo truena, no se renderiza nada. El checkout del
 *    comercio NUNCA se rompe por culpa de Ork.
 *  - Sin dependencias, sin cookies, sin fetch. Solo abre una ventana.
 *  - No pide datos de tarjeta ni los toca.
 */
(function () {
  "use strict";

  // Origen desde el que se cargó este script. Así el snippet funciona igual en
  // localhost que en producción sin configurarlo.
  var ORIGIN = (function () {
    try {
      var s = document.currentScript && document.currentScript.src;
      return s ? new URL(s).origin : window.location.origin;
    } catch (e) {
      return window.location.origin;
    }
  })();

  var PRIMARY = "#6C2EFF";

  function payUrl(opts) {
    var u = new URL("/pay", ORIGIN);
    if (opts.merchant) u.searchParams.set("merchant", opts.merchant);
    if (opts.plan) u.searchParams.set("plan", opts.plan);
    return u.toString();
  }

  function open(opts) {
    var url = payUrl(opts);
    var w = 460;
    var h = 760;
    var y = window.top.outerHeight / 2 + window.top.screenY - h / 2;
    var x = window.top.outerWidth / 2 + window.top.screenX - w / 2;
    var win = window.open(
      url,
      "ork",
      "width=" + w + ",height=" + h + ",top=" + y + ",left=" + x
    );
    // Si el navegador bloqueó la ventana emergente, no dejamos al usuario sin
    // salida: navegamos en la misma pestaña.
    if (!win || win.closed) window.location.href = url;
  }

  function mount(host, opts) {
    if (!host || host.__orkMounted) return;
    host.__orkMounted = true;
    opts = opts || {};

    var root = host.attachShadow
      ? host.attachShadow({ mode: "open" })
      : host; // navegador sin Shadow DOM: se renderiza igual, sin aislamiento

    var style = document.createElement("style");
    style.textContent = [
      ":host{all:initial;display:block}",
      ".b{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;",
      "gap:.5rem;width:100%;min-height:44px;padding:12px 18px;border-radius:10px;",
      "background:" + PRIMARY + ";color:#fff;cursor:pointer;",
      "font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;font-weight:600;",
      "line-height:1.2;text-align:center}",
      ".b:hover{background:#7D45FF}",
      ".b:focus-visible{outline:2px solid #A959FF;outline-offset:2px}",
      ".d{width:6px;height:6px;border-radius:50%;background:#fff;flex:none}",
      "@media (prefers-reduced-motion:reduce){.b{transition:none}}",
    ].join("");

    var btn = document.createElement("button");
    btn.type = "button"; // nunca submit: no enviamos el formulario del comercio
    btn.className = "b";
    btn.setAttribute("aria-label", "Pagar con Ork y elegir tu fecha de cobro");

    var dot = document.createElement("span");
    dot.className = "d";
    dot.setAttribute("aria-hidden", "true");

    var label = document.createElement("span");
    label.textContent = "Pagar con Ork — elige tu fecha";

    btn.appendChild(dot);
    btn.appendChild(label);
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      open(opts);
    });

    root.appendChild(style);
    root.appendChild(btn);
  }

  function auto() {
    var nodes = document.querySelectorAll("[data-ork]");
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      mount(n, { merchant: n.getAttribute("data-merchant"), plan: n.getAttribute("data-plan") });
    }
  }

  window.Ork = { mount: mount, open: open, payUrl: payUrl };

  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", auto);
    } else {
      auto();
    }
  } catch (e) {
    // En silencio, a propósito: el checkout del comercio no se rompe por Ork.
  }
})();
