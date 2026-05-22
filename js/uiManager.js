// uiManager.js
class UIManager {
  constructor() {
    this.elements = {};
  }

  init() {
    // Chỉ lấy elements khi DOM đã sẵn sàng
    this.elements = {
      // Device  panel
      devicePanel: document.getElementById("devicePanel"),
      deviceName: document.getElementById("deviceName"),
      btnSyncTime: document.getElementById("btnSyncTime"),
      btnSyncTimezone: document.getElementById("btnSyncTimezone"),
      btnGetDate: document.getElementById("btnGetDate"),
      btnGetMTU: document.getElementById("btnGetMTU"),

      // BLE control panel
      statusBLEIcon: document.getElementById("statusBLEIcon"),
      statusBLEText: document.getElementById("statusBLEText"),
      connectBLEBtn: document.getElementById("connectBLEBtn"),
      disconnectBLEBtn: document.getElementById("disconnectBLEBtn"),

      // Terminal
      terminalOutput: document.getElementById("terminal"),
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
      progressContainer: document.getElementById("progressContainer"),
      progressBar: document.getElementById("progressBar"),
      progressText: document.getElementById("progressText"),
    };
  }

  // Cập nhật trạng thái kết nối Bluetooth (BLE)
  updateDeviceStatus(isConnected,deviceName = "") {
    if (isConnected) {
      this.elements.deviceName.textContent = deviceName;
    } else {
      this.elements.deviceName.textContent = "------";
    }
  }

  // Cập nhật trạng thái kết nối Bluetooth (BLE)
  updateConnectionBLEStatus(isConnected, deviceName = "", deviceId = "") {
    this.updateDeviceStatus(isConnected,deviceName);
    this.elements.connectBLEBtn.classList.toggle("hidden", isConnected);
    this.elements.disconnectBLEBtn.classList.toggle("hidden", !isConnected);
    if (isConnected) {
      this.elements.statusBLEIcon.className = "status-dot bg-green-500";
      this.elements.statusBLEText.classList.replace("text-gray-300", "text-green-400");
      this.elements.statusBLEText.textContent = "ONLINE";
    } else {
      this.elements.statusBLEIcon.className = "status-dot bg-gray-500";
      this.elements.statusBLEText.classList.replace("text-green-400", "text-gray-300");
      this.elements.statusBLEText.textContent = "OFFLINE";
    }
  }

  // Cập nhật trạng thái kết nối SERIAL (UART)
  updateConnectionUartStatus(isConnected) {
    this.updateDeviceStatus(isConnected,"UART Device");
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
