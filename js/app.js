// js/app.js
import { UI } from "./ui.js";
import { BLE } from "./ble.js";
import { Transfer } from "./transfer.js";

const App = (() => {
  // ================= CONNECT =================
  const handleConnect = async () => {
    try {
      UI.log("Đang scan...");

      const device = await BLE.connect();

      UI.log("Connected", "success");
      UI.setConnected(true);

      // auto disconnect
      device.addEventListener("gattserverdisconnected", () => {
        UI.setConnected(false);
        UI.log("Mất kết nối", "error");
      });

      const services = await BLE.discoverServices();

      UI.renderServices(services, showService);

      UI.updateRSSI(-50);
    } catch (e) {
      UI.log(e.message, "error");
    }
  };

  // ================= SHOW SERVICE =================
  const showService = async (service) => {
    try {
      UI.log("Service: " + service.uuid);

      const chars = await BLE.getCharacteristics(service);

      // 🔥 QUAN TRỌNG: dùng UI render chuẩn
      UI.renderCharacteristics(chars, {
        read: BLE.read,
        write: BLE.write,
        startNotify: BLE.startNotify,
        stopNotify: BLE.stopNotify,
      });
    } catch (e) {
      UI.log("Load char lỗi: " + e.message, "error");
    }
  };

  // ================= DISCONNECT =================
  const handleDisconnect = () => {
    BLE.disconnect();
    UI.setConnected(false);
    UI.log("Disconnected", "error");
  };

  // ================= INIT =================
  const init = async () => {
    UI.init();
    UI.bindTabs();

    await UI.loadTransferHTML();

    Transfer.renderFiles(["Firmware OTA v1.0.bin", "Config JSON", "Device Backup", "System Log File", "User Data Export", "Security Patch Update", "Diagnostic Report", "Performance Metrics", "Error Log File", "Custom Data File"]);

    UI.el.connectBtn.addEventListener("click", handleConnect);
    UI.el.disconnectBtn.addEventListener("click", handleDisconnect);
  };
  return { init };
})();

window.addEventListener("DOMContentLoaded", App.init);
