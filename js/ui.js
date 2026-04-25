// js/ui.js
import { decode } from "./utils/decoder.js";

export const UI = (() => {
  const el = {};

  const init = () => {
    Object.assign(el, {
      connectBtn: document.getElementById("connectBtn"),
      disconnectBtn: document.getElementById("disconnectBtn"),

      statusText: document.getElementById("statusText"),
      statusIcon: document.getElementById("statusIcon"),

      servicesList: document.getElementById("servicesList"),
      terminal: document.getElementById("terminal"),

      rssiValue: document.getElementById("rssiValue"),
      rssiBar: document.getElementById("rssiBar"),

      characteristicsList: document.getElementById("characteristicsList"),
      detailsPlaceholder: document.getElementById("detailsPlaceholder"),
      detailsContent: document.getElementById("detailsContent"),

      // 👇 TAB
      tabService: document.getElementById("tabService"),
      tabTransfer: document.getElementById("tabTransfer"),
      contentService: document.getElementById("contentService"),
      contentTransfer: document.getElementById("contentTransfer"),
    });
  };

  // ================= TAB =================
  const switchTab = (tab) => {
    if (tab === "service") {
      el.contentService.classList.remove("hidden");
      el.contentTransfer.classList.add("hidden");

      el.tabService.classList.add("tab-active");
      el.tabService.classList.remove("tab-inactive");

      el.tabTransfer.classList.add("tab-inactive");
      el.tabTransfer.classList.remove("tab-active");
    } else {
      el.contentService.classList.add("hidden");
      el.contentTransfer.classList.remove("hidden");

      el.tabTransfer.classList.add("tab-active");
      el.tabTransfer.classList.remove("tab-inactive");

      el.tabService.classList.add("tab-inactive");
      el.tabService.classList.remove("tab-active");
    }
  };

  const bindTabs = () => {
    el.tabService.onclick = () => switchTab("service");
    el.tabTransfer.onclick = () => switchTab("transfer");
  };

  // ================= LOG =================
  const log = (msg, type = "info") => {
    const colors = {
      error: "text-red-400",
      success: "text-green-400",
      info: "text-blue-300",
    };

    const time = new Date().toLocaleTimeString();
    el.terminal.innerHTML += `
      <div class="${colors[type]}">
        <span class="text-slate-600">[${time}]</span> ${msg}
      </div>
    `;

    el.terminal.scrollTop = el.terminal.scrollHeight;
  };

  // ================= STATUS =================
  const setConnected = (state) => {
    el.statusText.textContent = state ? "ONLINE" : "OFFLINE";

    el.statusIcon.className = `status-dot ${
      state ? "bg-green-500" : "bg-slate-300"
    }`;

    el.connectBtn.classList.toggle("hidden", state);
    el.disconnectBtn.classList.toggle("hidden", !state);
  };

  const updateRSSI = (rssi) => {
    el.rssiValue.textContent = rssi;
    const percent = Math.min(Math.max((rssi + 100) * 1.4, 0), 100);
    el.rssiBar.style.width = percent + "%";
  };

  const renderServices = (services, onClick) => {
    el.servicesList.innerHTML = "";

    services.forEach((service) => {
      const div = document.createElement("div");
      div.className =
        "service-card p-3 bg-white border rounded-xl cursor-pointer hover:bg-blue-50";

      div.innerHTML = `<div class="font-bold text-xs uppercase">${service.uuid}</div>`;
      div.onclick = () => onClick(service);

      el.servicesList.appendChild(div);
    });
  };

  const renderCharacteristics = (chars, bleActions) => {
    el.characteristicsList.innerHTML = "";

    chars.forEach((char) => {
      const template = document
        .getElementById("charTemplate")
        .content.cloneNode(true);

      template.querySelector(".char-name").textContent = char.uuid;
      template.querySelector(".char-uuid").textContent = char.uuid;

      el.characteristicsList.appendChild(template);
    });

    el.detailsPlaceholder.classList.add("hidden");
    el.detailsContent.classList.remove("hidden");
  };

  const loadTransferHTML = async () => {
  const container = document.getElementById("contentTransfer");

  try {
    const res = await fetch("./components/transfer.html");
    const html = await res.text();

    container.innerHTML = html;
  } catch (e) {
    console.error("Load transfer.html lỗi:", e);
  }
};

  return {
    init,
    bindTabs,
    log,
    setConnected,
    updateRSSI,
    renderServices,
    renderCharacteristics,
    loadTransferHTML,
    el,
  };
})();