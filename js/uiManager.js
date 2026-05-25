// uiManager.js
import { CONSTANTS } from "./constants.js";
import { AppState } from "./appState.js";
class UIManager {
  constructor() {
    this.elements = {};
  }

  init() {
    // Chỉ lấy elements khi DOM đã sẵn sàng
    this.elements = {
      // Toast
      toastContainer: document.getElementById("toast-container"),
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
      remoteSendDir: document.getElementById("remoteSendDir"),
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

      // Chart Control buttons
      btnStartChart: document.getElementById("btn-start-chart"),
      btnStopChart: document.getElementById("btn-stop-chart"),
      btnResetChart: document.getElementById("btn-reset-chart"),

      // Chart Canvas & overlay
      canvas: document.getElementById("chart-canvas"),
      chartOverlayPause: document.getElementById("chart-overlay-bagde"),

      // FILE LOGGING ELEMENTS
      allowFileLoggingToggle: document.getElementById("file-logging-toggle"),
      loggingConfigPanel: document.getElementById("logging-config-panel"),
      pathLoggingText: document.getElementById("path-logging-text"),
      setFileLoggingBtn: document.getElementById("set-file-logging-btn"),
      startFileLoggingBtn: document.getElementById("start-file-logging-btn"),
      finishFileLoggingBtn: document.getElementById("finish-file-logging-btn"),
    };
  }

  // --- Toast Notification ---
  /**
   * Show a toast notification with the given message and type.
   * @param {'success' | 'default'} type
   * @param {string} message
   */
  showToastNotification(type = "success", message) {
    const toast = document.createElement("div");
    toast.className = `flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg border text-sm transition-all duration-300 transform translate-y-2 opacity-0 pointer-events-auto`;
    if (type === "success") {
      toast.className += " bg-emerald-950/90 border-emerald-500/30 text-emerald-400";
      toast.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>${message}</span>`;
    } else {
      toast.className += " bg-amber-950/90 border-amber-500/30 text-amber-400";
      toast.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> <span>${message}</span>`;
    }
    this.elements.toastContainer.appendChild(toast);
    setTimeout(() => toast.classList.remove("translate-y-2", "opacity-0"), 10);
    setTimeout(() => {
      toast.classList.add("translate-y-2", "opacity-0");
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Cập nhật trạng thái kết nối Bluetooth (BLE)
  updateDeviceStatus(isConnected, deviceName = "") {
    if (isConnected) {
      this.elements.deviceName.textContent = deviceName;
    } else {
      this.elements.deviceName.textContent = "------";
    }
  }

  // Cập nhật trạng thái kết nối Bluetooth (BLE)
  updateConnectionBLEStatus(isConnected, deviceName = "", deviceId = "") {
    this.updateDeviceStatus(isConnected, deviceName);
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
    this.updateDeviceStatus(isConnected, "UART Device");
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
  /**
   * Updates the UI for the Chart controls based on AppState.
   */
  updateChartControlUI() {
    const chartState = AppState.chartStatus;
    switch (chartState) {
      case CONSTANTS.CHART_STATUS.NONE:
        UI.elements.btnStartChart.classList.remove("opacity-50", "pointer-events-none");
        UI.elements.btnStopChart.classList.add("opacity-50", "pointer-events-none");
        UI.elements.chartOverlayPause.classList.add("opacity-0", "pointer-events-none");

        break;
      case CONSTANTS.CHART_STATUS.RENDERING:
        UI.elements.btnStartChart.classList.add("opacity-50", "pointer-events-none");
        UI.elements.btnStopChart.classList.remove("opacity-50", "pointer-events-none");
        UI.elements.chartOverlayPause.classList.remove("opacity-0", "pointer-events-none");

        break;
      default:
        break;
    }
  }

  /**
   * Updates the UI for the File Logging section based on AppState.
   */
  updateFileLoggingUI() {
    const allowRecord = this.elements.allowFileLoggingToggle.checked;
    const loggingStatus = AppState.loggingStatus;
    const mode = AppState.loggingMode;
    const filename = AppState.loggingFilename;

    // 1. Control visibility of the logging config panel
    this.elements.loggingConfigPanel.classList.toggle("hidden", !allowRecord);

    // 2. Update path display and set file button visibility based on mode
    if (allowRecord) {
      if (mode === CONSTANTS.LOGGING_MODE.WRITE_FILE_DIRECTLY) {
        this.elements.pathLoggingText.textContent = `Save file at: ${filename}`;
        this.elements.setFileLoggingBtn.classList.remove("hidden");
        this.elements.pathLoggingText.classList.remove("hidden");
        this.elements.finishFileLoggingBtn.classList.remove("hidden");
      } else if (mode === CONSTANTS.LOGGING_MODE.WRITE_BUFFER) {
        this.elements.pathLoggingText.textContent = "";
        this.elements.setFileLoggingBtn.classList.add("hidden");
        this.elements.pathLoggingText.classList.add("hidden");
        this.elements.finishFileLoggingBtn.classList.remove("hidden");
      }
    }

    // 3. Update button states and toggle disabled state based on loggingStatus
    this.elements.allowFileLoggingToggle.disabled = false; // Default to enabled

    // Reset all buttons to default (enabled) before applying specific states
    this.elements.setFileLoggingBtn.classList.remove("opacity-50", "pointer-events-none");
    this.elements.startFileLoggingBtn.classList.remove("opacity-50", "pointer-events-none");
    this.elements.finishFileLoggingBtn.classList.remove("opacity-50", "pointer-events-none");

    switch (loggingStatus) {
      case CONSTANTS.LOGGING_FILE_STATUS.NONE:
        this.elements.startFileLoggingBtn.classList.add("opacity-50", "pointer-events-none");
        this.elements.finishFileLoggingBtn.classList.add("opacity-50", "pointer-events-none");
        break;
      case CONSTANTS.LOGGING_FILE_STATUS.READY:
        this.elements.setFileLoggingBtn.classList.add("opacity-50", "pointer-events-none");
        this.elements.finishFileLoggingBtn.classList.add("opacity-50", "pointer-events-none");
        break;
      case CONSTANTS.LOGGING_FILE_STATUS.LOGGING:
        this.elements.allowFileLoggingToggle.disabled = true;
        this.elements.setFileLoggingBtn.classList.add("opacity-50", "pointer-events-none");
        this.elements.startFileLoggingBtn.classList.add("opacity-50", "pointer-events-none");
        break;
      case CONSTANTS.LOGGING_FILE_STATUS.FINISH:
        this.elements.setFileLoggingBtn.classList.remove("opacity-50", "pointer-events-none");
        this.elements.startFileLoggingBtn.classList.add("opacity-50", "pointer-events-none");
        this.elements.finishFileLoggingBtn.classList.add("opacity-50", "pointer-events-none");
        break;

      default:
        break;
    }
  }
}

// Export một instance duy nhất (Singleton Pattern)
/** @type {UIManager} */
export const UI = new UIManager();
