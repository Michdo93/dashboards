/**
 * app.js - View-Schicht + Basis-UI (Kiosk/Tabs/Uhr) für das Smart Home Dashboard
 * (unabhängig von HABPanel/CometVisu)
 *
 * Architektur: MVC mit Observable-Pattern, aufgeteilt auf drei Dateien:
 *   model.js       - OHItem (Observable) + ItemStore (Registry)
 *   app.js (hier)  - View: DOM-Elemente an Model-Items binden, Kiosk/Tabs/Uhr/Toast
 *   controller.js  - App: verdrahtet Model+View, SSE-Live-Updates
 *
 * Ein DOM-Element "abonniert" über bindElement() sein Model-Item
 * (item.subscribe(render)) und aktualisiert sich selbst, sobald sich der
 * State ändert - unabhängig davon, ob die Änderung vom Initial-Load oder
 * von einem Live-Event kommt.
 *
 * Bindungs-Konvention für HTML-Elemente:
 *   data-oh-item="ItemName"              - welches openHAB-Item
 *   data-oh-type="dimmer|rollershutter|datetime"  - wie der Wert interpretiert wird (optional)
 *   data-oh-command="UP|DOWN|STOP|ON|..."- fester Befehl, der bei Klick gesendet wird
 *   data-oh-send="ItemName"              - Button sendet den Text aus data-oh-source als Command
 *   data-oh-source="input-id"            - zugehöriges <input>-Feld für data-oh-send
 *   data-oh-display="element-id"         - wohin der Prozent-/Zahlenwert eines Sliders gespiegelt wird
 *   data-oh-decimals="1"                 - Nachkommastellen bei Zahlen
 *   data-oh-suffix=" °C"                 - Einheit/Suffix beim Anzeigen
 *   data-oh-format="dd.MM. HH:mm"        - Datumsformat bei data-oh-type="datetime"
 *   data-oh-map="ON:Gesperrt,OFF:Offen"  - Rohzustand -> Anzeigetext
 *   data-oh-badge-map="OPEN:badge-alert,CLOSED:badge-ok" - Rohzustand -> CSS-Klasse für Badges
 *   data-oh-ok-value="ON"                - einfache 2-Zustands-Variante von data-oh-badge-map
 *   data-oh-on-value / data-oh-off-value - eigene Werte für Toggle-Switches (Default ON/OFF)
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // 1) Kiosk- & Raum-Modus
  //
  //    ?kiosk=on               -> Kiosk-Optik, Menü bleibt sichtbar
  //                               ("Tablet für alle Räume": kann jeden Tab anklicken)
  //    ?kiosk=on&raum=kueche   -> zusätzlich Menü/Kopfzeile komplett ausgeblendet,
  //                               fest auf einen Raum verriegelt (Küche/Bad/IoT/Multimedia-Tablets)
  //    Gültige Werte für raum: smarthome, konferenz, kueche, bad, iot, multimedia
  // ---------------------------------------------------------------------
  const params = new URLSearchParams(window.location.search);
  const isKiosk = params.get("kiosk") === "on";
  const lockedRoom = params.get("raum");

  if (isKiosk) document.body.classList.add("kiosk-mode");
  if (lockedRoom) document.body.classList.add("room-locked");

  // ---------------------------------------------------------------------
  // 2) Tab-Navigation
  // ---------------------------------------------------------------------
  function switchTab(tabId) {
    const btn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
    const tab = document.getElementById(`tab-${tabId}`);
    if (!btn || !tab) return;

    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    tab.classList.add("active");

    const title = document.getElementById("page-title");
    if (title) title.innerText = (btn.getAttribute("data-label") || btn.innerText.trim()) + " Dashboard";
  }
  window.switchTab = switchTab;

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (document.body.classList.contains("room-locked")) return; // Navigation gesperrt
      const tabId = btn.getAttribute("data-tab");
      switchTab(tabId);
      window.location.hash = tabId;
    });
  });

  // Nicht an openHAB gebundene Demo-Toggles (in den übrigen Räumen) bleiben rein optisch klickbar
  document.querySelectorAll(".toggle-switch:not([data-oh-item])").forEach((toggle) => {
    toggle.addEventListener("click", () => toggle.classList.toggle("active"));
  });

  // ---------------------------------------------------------------------
  // 3) Uhrzeit
  // ---------------------------------------------------------------------
  function updateClock() {
    const el = document.getElementById("clock-display");
    if (!el) return;
    el.innerText = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }
  setInterval(updateClock, 1000);
  updateClock();

  // ---------------------------------------------------------------------
  // 4) Format-Hilfsfunktionen (reine Funktionen, keine Abhängigkeit auf DOM/Model)
  // ---------------------------------------------------------------------
  function formatValue(state, el) {
    const type = el.getAttribute("data-oh-type");
    const suffix = el.getAttribute("data-oh-suffix") || "";
    if (type === "datetime") {
      const d = new Date(state);
      if (isNaN(d)) return state;
      return formatDate(d, el.getAttribute("data-oh-format") || "dd.MM. HH:mm");
    }
    const decimals = el.getAttribute("data-oh-decimals");
    if (decimals !== null) {
      const num = parseFloat(state);
      if (!isNaN(num)) return num.toFixed(Number(decimals)) + suffix;
    }
    return state + suffix;
  }

  /** Formatiert einen Roh-State anhand von openHABs eigenem stateDescription.pattern
   *  (Java-Format-String, z.B. "%.3f kWh", "%s", "%1$tH:%1$tM", "%d %%"). Das ist die
   *  vom Server selbst gelieferte, verbindliche Formatierung - inkl. Einheit und
   *  Nachkommastellen - und damit zuverlässiger als jede eigene Rate-Heuristik.
   *  Gibt null zurück, wenn kein nutzbares Muster vorliegt (Aufrufer soll dann
   *  selbst formatieren, z.B. über data-oh-* Attribute als Fallback). */
  function formatFromPattern(rawState, pattern) {
    if (!pattern || typeof rawState !== "string") return null;

    // openHAB-Sonderfall bei Quantity-Types: "%unit%" ist kein printf-Platzhalter,
    // sondern wird durch die im State selbst enthaltene Einheit ersetzt
    // (z.B. State "21.5 °C" bei Pattern "%.1f %unit%" -> Einheit "°C" aus dem State ziehen).
    if (pattern.includes("%unit%")) {
      const unitMatch = rawState.match(/[^\d.\-,\s]+$/);
      pattern = pattern.replace("%unit%", unitMatch ? unitMatch[0].trim() : "");
    }

    // DateTime: enthält %[n$]t<Buchstabe> Token (z.B. %1$tH:%1$tM)
    if (/%\d*\$?t[A-Za-z]/.test(pattern)) {
      // Ziffern direkt aus dem ISO-String lesen (zeitzonen-unabhängig) - so wird
      // immer die vom Server gemeinte Uhrzeit gezeigt, unabhängig von der
      // Zeitzone des Browsers, der das Dashboard gerade anzeigt.
      const iso = rawState.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
      let conv;
      if (iso) {
        const [, Y, m, d, H, M, S] = iso;
        conv = { H, M, S, Y, y: Y.slice(-2), m, d };
      } else {
        const d = new Date(rawState);
        if (isNaN(d)) return rawState;
        const pad = (n) => String(n).padStart(2, "0");
        conv = {
          H: pad(d.getHours()), M: pad(d.getMinutes()), S: pad(d.getSeconds()),
          Y: String(d.getFullYear()), y: String(d.getFullYear()).slice(-2),
          m: pad(d.getMonth() + 1), d: pad(d.getDate()),
          B: d.toLocaleString("de-DE", { month: "long" }),
          b: d.toLocaleString("de-DE", { month: "short" }),
          A: d.toLocaleString("de-DE", { weekday: "long" }),
          a: d.toLocaleString("de-DE", { weekday: "short" }),
        };
      }
      return pattern.replace(/%\d*\$?t([A-Za-z])/g, (_, c) => (conv[c] !== undefined ? conv[c] : ""));
    }

    // Fließkommazahl: %[n$][.Nachkommastellen]f - Rest des Musters (z.B. " kWh") bleibt als Text stehen
    const floatMatch = pattern.match(/%\d*\$?\.?(\d*)f/);
    if (floatMatch) {
      const num = parseFloat(rawState);
      if (isNaN(num)) return rawState;
      const decimals = floatMatch[1] ? Number(floatMatch[1]) : 0;
      return pattern.replace(/%\d*\$?\.?\d*f/, num.toFixed(decimals)).replace(/%%/g, "%");
    }

    // Ganzzahl: %[n$]d
    if (/%\d*\$?d/.test(pattern)) {
      const num = parseInt(rawState, 10);
      if (isNaN(num)) return rawState;
      return pattern.replace(/%\d*\$?d/, String(num)).replace(/%%/g, "%");
    }

    // Text: %[n$]s
    if (/%\d*\$?s/.test(pattern)) {
      return pattern.replace(/%\d*\$?s/, rawState).replace(/%%/g, "%");
    }

    return null; // unbekanntes Muster - Aufrufer soll selbst formatieren
  }

  function formatDate(d, fmt) {
    const pad = (n) => String(n).padStart(2, "0");
    return fmt
      .replace("dd", pad(d.getDate()))
      .replace("MM", pad(d.getMonth() + 1))
      .replace("yyyy", d.getFullYear())
      .replace("HH", pad(d.getHours()))
      .replace("mm", pad(d.getMinutes()));
  }

  function hsbToRgb(h, s, b) {
    s /= 100;
    b /= 100;
    const k = (n) => (n + h / 60) % 6;
    const f = (n) => b - b * s * Math.max(0, Math.min(k(n), 4 - k(n), 1));
    return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
  }

  // ---------------------------------------------------------------------
  // 5) Toast-Feedback (Bootstrap) bei gesendeten Befehlen
  // ---------------------------------------------------------------------
  function showToast(text) {
    const toastEl = document.getElementById("oh-toast");
    const body = document.getElementById("oh-toast-body");
    if (!toastEl || !window.bootstrap) return;
    body.innerText = text;
    bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 1800 }).show();
  }

  // =======================================================================
  // 6) VIEW - DOM-Elemente an Model-Items binden
  // =======================================================================

  /** Rendert einen Item-State in ein einzelnes DOM-Element, abhängig vom Element-Typ. */
  function renderInto(el) {
    return (state, item) => {
      if (el.classList.contains("toggle-switch")) {
        const onVal = el.getAttribute("data-oh-on-value") || "ON";
        el.classList.toggle("active", state === onVal);
        return;
      }
      if (el.tagName === "INPUT" && el.type === "range") {
        const num = parseFloat(state);
        if (!isNaN(num)) el.value = num;
        const disp = el.getAttribute("data-oh-display");
        if (disp) {
          const d = document.getElementById(disp);
          if (d) d.innerText = isNaN(num) ? "--%" : Math.round(num) + "%";
        }
        return;
      }
      if (el.classList.contains("colorwheel")) {
        const parts = String(state).split(",").map(Number);
        if (parts.length === 3 && el._ohSetHSB) el._ohSetHSB(parts[0], parts[1], parts[2]);
        return;
      }

      // Text-/Badge-Elemente
      const map = el.getAttribute("data-oh-map");
      let label = state;
      if (map) {
        const dict = Object.fromEntries(map.split(",").map((p) => p.split(":")));
        label = dict[state] !== undefined ? dict[state] : state;
      } else {
        // 1. Priorität: openHABs eigenes stateDescription.pattern (verbindlich vom Server)
        // 2. Fallback: unsere eigenen data-oh-* Attribute (falls kein/kein nutzbares Pattern)
        const fromPattern = item ? formatFromPattern(state, item.pattern) : null;
        label = fromPattern !== null ? fromPattern : formatValue(state, el);
      }
      el.innerText = label;

      const badgeMap = el.getAttribute("data-oh-badge-map");
      if (badgeMap) {
        const dict = Object.fromEntries(badgeMap.split(",").map((p) => p.split(":")));
        el.classList.remove("badge-ok", "badge-warning", "badge-alert");
        el.classList.add(dict[state] || "badge-ok");
      } else if (el.hasAttribute("data-oh-ok-value")) {
        const ok = state === el.getAttribute("data-oh-ok-value");
        el.classList.remove("badge-ok", "badge-warning", "badge-alert");
        el.classList.add(ok ? "badge-ok" : "badge-alert");
      }
    };
  }

  /** Für Buttons mit festem Befehl (data-oh-command): Text/Icon bleiben immer
   *  gleich, unabhängig vom State - der State sagt nur, OB der Button gerade
   *  "aktiv" ist (z.B. welche Quelle/welcher Modus aktuell gewählt ist). */
  function renderButtonHighlight(el) {
    return (state) => {
      const cmd = el.getAttribute("data-oh-command");
      el.classList.toggle("active", state === cmd);
    };
  }

  /** Bindet ein einzelnes [data-oh-item]-Element an sein Model-Item (View <-> Model). */
  function bindElement(el, store) {
    const itemName = el.getAttribute("data-oh-item");
    if (!itemName) return;
    const item = store.get(itemName);
    if (el.tagName === "BUTTON" && el.hasAttribute("data-oh-command")) {
      item.subscribe(renderButtonHighlight(el));
    } else {
      item.subscribe(renderInto(el));
    }
  }

  /** Verdrahtet Benutzer-Interaktionen (Klick/Change) mit Model.sendCommand(). */
  function bindInteractions(store) {
    // Feste Befehle (Rollladen UP/STOP/DOWN, Gong, Medientasten, etc.)
    document.querySelectorAll("[data-oh-command]").forEach((el) => {
      el.addEventListener("click", () => {
        const item = store.get(el.getAttribute("data-oh-item"));
        item.sendCommand(el.getAttribute("data-oh-command"));
      });
    });

    // Freitext senden (SMS/WhatsApp/Telegram/E-Mail/TTS/...)
    document.querySelectorAll("[data-oh-send]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = store.get(btn.getAttribute("data-oh-send"));
        const input = document.getElementById(btn.getAttribute("data-oh-source"));
        if (input && input.value.trim()) {
          item.sendCommand(input.value.trim());
          input.value = "";
        }
      });
    });

    // Slider (Dimmer/Rollershutter-Position/Orientierung)
    document.querySelectorAll('input[type="range"][data-oh-item]').forEach((slider) => {
      slider.addEventListener("input", () => {
        const disp = slider.getAttribute("data-oh-display");
        if (disp) {
          const d = document.getElementById(disp);
          if (d) d.innerText = slider.value + "%";
        }
      });
      slider.addEventListener("change", () => {
        store.get(slider.getAttribute("data-oh-item")).sendCommand(String(slider.value));
      });
    });

    // Schalter (Switch-Items und generische 2-Zustands-Toggles wie off/all bei Sonos Wiederholen/Zufall)
    document.querySelectorAll(".toggle-switch[data-oh-item]").forEach((sw) => {
      sw.addEventListener("click", () => {
        const item = store.get(sw.getAttribute("data-oh-item"));
        const onVal = sw.getAttribute("data-oh-on-value") || "ON";
        const offVal = sw.getAttribute("data-oh-off-value") || "OFF";
        const willBeOn = !sw.classList.contains("active");
        item.sendCommand(willBeOn ? onVal : offVal);
        sw.classList.toggle("active"); // optimistisch, per SSE bestätigt/korrigiert
      });
    });
  }

  // ---------------------------------------------------------------------
  // 6b) Interaktiver Farbkreis (HSB) - ersetzt <input type="color">
  //     Kreis liefert Farbton (Winkel) + Sättigung (Abstand von der Mitte),
  //     der Balken darunter die Helligkeit. Sendet "H,S,B" ans Color-Item.
  // ---------------------------------------------------------------------
  function initColorWheels(store) {
    document.querySelectorAll(".colorwheel[data-oh-item]").forEach((container) => setupColorWheel(container, store));
  }

  function setupColorWheel(container, store) {
    const canvas = container.querySelector(".colorwheel-canvas");
    const thumb = container.querySelector(".colorwheel-thumb");
    const brightness = container.querySelector(".colorwheel-brightness");
    const itemName = container.getAttribute("data-oh-item");
    if (!canvas || !thumb || !brightness || !itemName) return;
    const item = store.get(itemName);

    const size = canvas.width;
    const radius = size / 2;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - radius;
        const dy = y - radius;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const idx = (y * size + x) * 4;
        if (dist > radius) {
          imgData.data[idx + 3] = 0;
          continue;
        }
        let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (angle < 0) angle += 360;
        const sat = Math.min(1, dist / radius) * 100;
        const [r, g, b] = hsbToRgb(angle, sat, 100);
        imgData.data[idx] = r;
        imgData.data[idx + 1] = g;
        imgData.data[idx + 2] = b;
        imgData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    let h = 200, s = 60, b = 100;

    function moveThumb() {
      const rad = (h * Math.PI) / 180;
      const r = (s / 100) * radius;
      thumb.style.left = radius + r * Math.cos(rad) + "px";
      thumb.style.top = radius + r * Math.sin(rad) + "px";
    }

    function pickFromEvent(evt) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = size / rect.width;
      const scaleY = size / rect.height;
      const x = (evt.clientX - rect.left) * scaleX;
      const y = (evt.clientY - rect.top) * scaleY;
      const dx = x - radius;
      const dy = y - radius;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) dist = radius;
      let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (angle < 0) angle += 360;
      h = angle;
      s = (dist / radius) * 100;
      moveThumb();
    }

    let dragging = false;
    canvas.addEventListener("pointerdown", (e) => {
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      pickFromEvent(e);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (dragging) pickFromEvent(e);
    });
    canvas.addEventListener("pointerup", () => {
      if (dragging) {
        dragging = false;
        item.sendCommand(`${Math.round(h)},${Math.round(s)},${Math.round(b)}`);
      }
    });

    brightness.addEventListener("input", () => {
      b = Number(brightness.value);
    });
    brightness.addEventListener("change", () => {
      item.sendCommand(`${Math.round(h)},${Math.round(s)},${Math.round(b)}`);
    });

    // Für renderInto() erreichbar machen, um Live-Zustände nachzuziehen
    container._ohSetHSB = (nh, ns, nb) => {
      h = nh;
      s = ns;
      b = nb;
      moveThumb();
      brightness.value = nb;
    };
    moveThumb();
  }

  window.OHView = {
    renderInto,
    bindElement,
    bindInteractions,
    initColorWheels,
    showToast,
    formatValue,
    formatDate,
  };
})();
