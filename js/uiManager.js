// uiManager.js
class UIManager {
  constructor() {
    this.elements = {};
  }

  init() {
    // Chỉ lấy elements khi DOM đã sẵn sàng
    this.elements = {
      statusBLEIcon: document.getElementById("statusBLEIcon"),
      statusBLEText: document.getElementById("statusBLEText"),
      connectBLEBtn: document.getElementById("connectBLEBtn"),
      disconnectBLEBtn: document.getElementById("disconnectBLEBtn"),
      terminalOutput: document.getElementById("terminal"),
      devicePanel: document.getElementById("devicePanel"),
      deviceMac: document.getElementById("deviceMacDisplay"),
      rssi: document.getElementById("rssiValue"),
      terminalInput: document.getElementById("terminal-input"),
      clearTerminalBtn: document.getElementById("clearTerminalBtn"),
      sendTerminalBtn: document.getElementById("sendTerminalBtn"),

      // UART control panel
      statusUartIcon: document.getElementById("statusUartIcon"),
      statusUartText: document.getElementById("statusUartText"),
      connectUartBtn: document.getElementById("connectUartBtn"),
      disconnectUartBtn: document.getElementById("disconnectUartBtn"),

      // File transfer elements
      fileInput: document.getElementById("fileInput"),
      fileName: document.getElementById("fileName"),
      sendFileBtn: document.getElementById("sendFileBtn"),
      getFileBtn: document.getElementById("getFileBtn"),
      deviceFilePath: document.getElementById("deviceFilePath"),
      stopFileBtn: document.getElementById("stopFileBtn"),

      fileStatus: document.getElementById("fileStatus"),
      progressContainer: document.getElementById('progressContainer'),
      progressBar: document.getElementById('progressBar'),
      progressText: document.getElementById('progressText'),

    };
  }

  // Cập nhật trạng thái kết nối Bluetooth (BLE)
  updateConnectionBLEStatus(isConnected, deviceName = "",deviceId = "") {
    this.elements.connectBLEBtn.classList.toggle("hidden", isConnected);
    this.elements.disconnectBLEBtn.classList.toggle("hidden", !isConnected);

    if (isConnected) {
      this.elements.statusBLEIcon.className = "status-dot bg-green-500";
      this.elements.statusBLEText.classList.replace("text-gray-300", "text-green-400");
      this.elements.statusBLEText.textContent = "ONLINE";
      document.getElementById("deviceNameDisplay").textContent = deviceName || "Connected";
      this.elements.devicePanel.classList.remove("hidden");
      this.updateDeviceBLEInfo(deviceId, "N/A");
    } else {
      this.elements.statusBLEIcon.className = "status-dot bg-gray-500";
      this.elements.statusBLEText.classList.replace("text-green-400", "text-gray-300");
      this.elements.statusBLEText.textContent = "OFFLINE";
      this.elements.devicePanel.classList.add("hidden");
      this.updateDeviceBLEInfo("Searching...", "--");
    }
  }

  // Cập nhật thông tin chi tiết thiết bị BLE (MAC và RSSI)
  updateDeviceBLEInfo(id, rssi) {
    this.elements.deviceMac.textContent = id || "Unknown";
    this.elements.rssi.textContent = rssi ? `${rssi} dBm` : "-- dBm";
  }
  // Cập nhật trạng thái kết nối SERIAL (UART)
  updateConnectionUartStatus(isConnected) {
    this.elements.connectUartBtn.classList.toggle("hidden", isConnected);
    this.elements.disconnectUartBtn.classList.toggle("hidden", !isConnected);

    if (isConnected) {
      this.elements.statusUartIcon.className = "status-dot bg-green-500";
      this.elements.statusUartText.classList.replace("text-gray-300", "text-green-400");
      this.elements.statusUartText.textContent = "ONLINE";
    } else {
      this.elements.statusUartIcon.className = "status-dot bg-gray-500";
      this.elements.statusUartText.classList.replace("text-green-400", "text-gray-300");
      this.elements.statusUartText.textContent = "OFFLINE";
    }
  }
}

// Export một instance duy nhất (Singleton Pattern)
/** @type {UIManager} */
export const UI = new UIManager();
