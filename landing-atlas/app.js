/* Atlas Seller — landing V2 (vanilla JS) */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function brl(v) {
    return "R$ " + v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  /* ---------- Barra de progresso de scroll ---------- */
  var progress = document.querySelector(".scroll-progress i");
  if (progress && !reduced) {
    var ticking = false;
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        progress.style.transform = "scaleX(" + (max > 0 ? window.scrollY / max : 0) + ")";
        ticking = false;
      });
    }, { passive: true });
  }

  /* ---------- Ticket ao vivo (hero) ---------- */
  var ORDERS = [
    { id: "#701-2049", name: "Suporte articulado p/ monitor", gross: 129.9, cost: 38.0 },
    { id: "#702-8815", name: "Cafeteira prensa francesa 600ml", gross: 89.9, cost: 26.5 },
    { id: "#703-4432", name: "Luminária de mesa LED touch", gross: 159.9, cost: 52.0 },
    { id: "#704-9107", name: "Balança digital de cozinha 10kg", gross: 219.9, cost: 84.0 },
    { id: "#705-3376", name: "Organizador de cabos magnético", gross: 112.9, cost: 34.9 }
  ];
  var ticket = document.getElementById("ticket");

  function fillTicket(o) {
    var com = o.gross * 0.15;
    var fba = 8.5;
    var parc = o.gross * 0.035;
    var tax = o.gross * 0.07;
    var profit = o.gross - com - fba - parc - tax - o.cost;
    var margin = (profit / o.gross) * 100;
    var set = function (key, val) {
      ticket.querySelector('[data-tk="' + key + '"]').textContent = val;
    };
    set("id", o.id);
    set("name", o.name);
    set("gross", brl(o.gross));
    set("fee0", "− " + brl(com));
    set("fee1", "− " + brl(fba));
    set("fee2", "− " + brl(parc));
    set("fee3", "− " + brl(tax));
    set("fee4", "− " + brl(o.cost));
    set("profit", brl(profit));
    set("margin", "margem " + margin.toFixed(1).replace(".", ",") + "%");
  }

  if (ticket) {
    var idx = 0;
    fillTicket(ORDERS[0]);
    if (!reduced) {
      setInterval(function () {
        ticket.classList.add("swap");
        setTimeout(function () {
          idx = (idx + 1) % ORDERS.length;
          fillTicket(ORDERS[idx]);
          /* reinicia a cascata das linhas */
          var fees = ticket.querySelectorAll(".tk-fees li");
          Array.prototype.forEach.call(fees, function (li) {
            li.style.animation = "none";
            void li.offsetWidth;
            li.style.animation = "";
          });
          ticket.classList.remove("swap");
        }, 320);
      }, 4600);
    }
  }

  /* ---------- Calculadora ---------- */
  var priceIn = document.getElementById("calc-price");
  var costIn = document.getElementById("calc-cost");

  function updateCalc() {
    if (!priceIn) return;
    var P = parseFloat(priceIn.value);
    var costPct = parseFloat(costIn.value) / 100;
    var com = P * 0.15;
    var fba = Math.min(8.5 + P * 0.02, 35);
    var parc = P * 0.035;
    var tax = P * 0.07;
    var cost = P * costPct;
    var profit = P - com - fba - parc - tax - cost;
    var margin = (profit / P) * 100;

    document.getElementById("calc-price-out").textContent = brl(P);
    document.getElementById("calc-cost-out").textContent = Math.round(costPct * 100) + "%";

    var rows = [
      ["gross", "bar-gross", "val-gross", P, ""],
      ["com", "bar-com", "val-com", com, "− "],
      ["fba", "bar-fba", "val-fba", fba, "− "],
      ["parc", "bar-parc", "val-parc", parc, "− "],
      ["tax", "bar-tax", "val-tax", tax, "− "],
      ["cost", "bar-cost", "val-cost", cost, "− "]
    ];
    rows.forEach(function (r) {
      var bar = document.getElementById(r[1]);
      var val = document.getElementById(r[2]);
      if (bar) bar.style.width = Math.max(0, (r[3] / P) * 100) + "%";
      if (val) val.textContent = r[4] + brl(r[3]);
    });
    var pBar = document.getElementById("bar-profit");
    var pVal = document.getElementById("val-profit");
    if (pBar) pBar.style.width = Math.max(0, (profit / P) * 100) + "%";
    if (pVal) pVal.innerHTML = brl(Math.max(0, profit)) + ' <small id="val-margin">(' + margin.toFixed(1).replace(".", ",") + "%)</small>";
  }

  if (priceIn && costIn) {
    priceIn.addEventListener("input", updateCalc);
    costIn.addEventListener("input", updateCalc);
    updateCalc();
  }

  /* ---------- Showcase de telas ---------- */
  var SHOT_CAPS = {
    vendas: "Cada pedido chega com a margem calculada: total, líquido do marketplace, imposto, custo e lucro — venda a venda.",
    breakdown: "Abra o pedido e veja a conta inteira: comissão, taxa FBA, imposto e custo do produto até o lucro final.",
    produto: "Cada SKU tem sua página: estoque, vendas 30d, preço, custo, margem, Buy Box, reembolsos e reviews — tudo junto.",
    avaliacoes: "Solicitação de avaliações via SP-API no piloto automático: fila, histórico e status por pedido.",
    agenda: "Tarefas da operação, contas fixas e vencimentos num só calendário, com alerta de atraso."
  };
  var showTabs = document.querySelector(".show-tabs");
  if (showTabs) {
    var showImgs = document.querySelectorAll("[data-shot-img]");
    var showCap = document.getElementById("show-cap");
    var setShot = function (name) {
      Array.prototype.forEach.call(showTabs.querySelectorAll("button"), function (b) {
        b.setAttribute("aria-selected", String(b.getAttribute("data-shot") === name));
      });
      Array.prototype.forEach.call(showImgs, function (im) {
        im.classList.toggle("active", im.getAttribute("data-shot-img") === name);
      });
      if (showCap && SHOT_CAPS[name]) showCap.textContent = SHOT_CAPS[name];
    };
    showTabs.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-shot]");
      if (btn) setShot(btn.getAttribute("data-shot"));
    });
    showTabs.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      var btns = Array.prototype.slice.call(showTabs.querySelectorAll("button"));
      var i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      var next = e.key === "ArrowRight" ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
      btns[next].focus();
      setShot(btns[next].getAttribute("data-shot"));
      e.preventDefault();
    });
  }

  /* ---------- Vídeos por funcionalidade: fallback quando o mp4 ainda não existe ---------- */
  Array.prototype.forEach.call(document.querySelectorAll(".vid-frame video"), function (v) {
    v.addEventListener("error", function () { v.closest(".vid-frame").classList.add("no-src"); }, true);
    if (v.error) v.closest(".vid-frame").classList.add("no-src");
  });

  /* ---------- Preços: ciclo de cobrança ---------- */
  var CYCLES = {
    mensal:     { months: 1,  discount: 0,    suffix: "/mês",       note: "Cobrança todo mês, cancele quando quiser" },
    trimestral: { months: 3,  discount: 0.05, suffix: "/trimestre", note: "Economize 5% pagando a cada 3 meses" },
    semestral:  { months: 6,  discount: 0.10, suffix: "/semestre",  note: "Economize 10% pagando a cada 6 meses" },
    anual:      { months: 12, discount: 0.15, suffix: "/ano",       note: "Economize 15% pagando uma vez ao ano" }
  };
  var toggle = document.querySelector(".price-toggle");
  var note = document.getElementById("price-note");
  var plans = Array.prototype.slice.call(document.querySelectorAll(".plan[data-monthly]"));
  var planLinks = Array.prototype.slice.call(document.querySelectorAll(".plan a[data-plan]"));

  function applyCycle(name) {
    var c = CYCLES[name];
    if (!c) return;
    plans.forEach(function (plan) {
      var monthly = parseFloat(plan.getAttribute("data-monthly"));
      var perMonth = monthly * (1 - c.discount);
      var total = perMonth * c.months;
      plan.querySelector(".price-value").textContent = brl(total);
      plan.querySelector(".price-cycle").textContent = c.suffix;
      plan.querySelector(".equiv").textContent = c.months > 1 ? "equivale a " + brl(perMonth) + "/mês" : "";
    });
    planLinks.forEach(function (a) {
      a.href = "checkout.html?plano=" + a.dataset.plan + "&ciclo=" + name;
    });
    if (note) note.textContent = c.note;
    Array.prototype.forEach.call(toggle.querySelectorAll("button"), function (btn) {
      btn.setAttribute("aria-selected", String(btn.getAttribute("data-cycle") === name));
    });
  }

  if (toggle) {
    toggle.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-cycle]");
      if (btn) applyCycle(btn.getAttribute("data-cycle"));
    });
    toggle.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      var btns = Array.prototype.slice.call(toggle.querySelectorAll("button"));
      var i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      var next = e.key === "ArrowRight" ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
      btns[next].focus();
      applyCycle(btns[next].getAttribute("data-cycle"));
      e.preventDefault();
    });
    applyCycle("mensal");
  }

  /* ---------- FAQ ---------- */
  var faqs = Array.prototype.slice.call(document.querySelectorAll(".faq-item"));
  faqs.forEach(function (item) {
    item.addEventListener("toggle", function () {
      if (!item.open) return;
      faqs.forEach(function (other) { if (other !== item) other.open = false; });
    });
  });

  /* ---------- Scroll reveal (+ steps e analytics) ---------- */
  var revealEls = Array.prototype.slice.call(document.querySelectorAll(".reveal, .step, .analytics-block"));
  if (reduced || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("in"); });
  } else {
    var seen = 0;
    var ioFired = false;
    var io = new IntersectionObserver(function (entries) {
      ioFired = true;
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        if (el.classList.contains("reveal")) {
          el.style.transitionDelay = (seen % 3) * 70 + "ms";
          seen++;
        }
        el.classList.add("in");
        io.unobserve(el);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    revealEls.forEach(function (el) { io.observe(el); });
    /* failsafe: nunca deixar conteúdo invisível se o IO não disparar
       ou se a timeline de transições estiver congelada */
    var forceIn = function (el) {
      el.style.transition = "none";
      el.classList.add("in");
      el.style.opacity = "1";
      el.style.transform = "none";
    };
    requestAnimationFrame(function () {
      revealEls.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) el.classList.add("in");
      });
    });
    setTimeout(function () {
      revealEls.forEach(function (el) {
        if (!ioFired || (el.classList.contains("in") && parseFloat(getComputedStyle(el).opacity) < 0.1)) forceIn(el);
      });
    }, 1200);
  }

  /* ---------- Vídeo ---------- */
  var video = document.querySelector(".demo-frame video");
  if (video) {
    if (reduced) {
      video.removeAttribute("autoplay");
      video.pause();
      video.setAttribute("controls", "");
    } else if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { video.play().catch(function () {}); }
          else { video.pause(); }
        });
      }, { threshold: 0.2 }).observe(video);
    }
  }
})();
