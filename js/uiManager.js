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
      btnPauseChart: document.getElementById("btn-pause-chart"),
      btnContinueChart: document.getElementById("btn-continue-chart"),
      btnClearChart: document.getElementById("btn-clear-chart"),

      // Chart Canvas & overlay
      canvas: document.getElementById("chart-canvas"),
      chartOverlayPause: document.getElementById("chart-pause-overlay-bagde"),
      chartOverlayRun: document.getElementById("chart-run-overlay-bagde"),
      btnFitChart: document.getElementById("btnFitChart"),
      btnAutoFit: document.getElementById("btnAutoFit"),

      // FILE LOGGING ELEMENTS
      allowFileLoggingToggle: document.getElementById("file-logging-toggle"),
      loggingConfigPanel: document.getElementById("logging-config-panel"),
      pathLoggingText: document.getElementById("path-logging-text"), // It set is "hidden", we do not use it now
      setFolderLoggingBtn: document.getElementById("set-folder-logging-btn"),
      startFileLoggingBtn: document.getElementById("start-file-logging-btn"),
      finishFileLoggingBtn: document.getElementById("finish-file-logging-btn"),
    };

    // STREAMING ELEMENTS
    this.elements.checkboxStreaming = document.getElementById("checkboxStreaming");
    this.elements.checkboxSimulationData = document.getElementById("checkboxSimulationData");

    // SENSOR PANEL
    this.elements.checkboxHX712 = document.getElementById("checkboxHX712");
    this.elements.sdHX712 = document.getElementById("sdHX712");
    this.elements.checkboxPiezo = document.getElementById("checkboxPiezo");
    this.elements.sdPiezo = document.getElementById("sdPiezo");
    this.elements.checkboxADS1115 = document.getElementById("checkboxADS1115");
    this.elements.sdADS1115 = document.getElementById("sdADS1115");
  }

  // --- Toast Notification ---
  /**
   * Show a toast notification with the given message and type.The toast locate at right-bottom website
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
        UI.elements.btnStartChart.classList.remove("opacity-20", "pointer-events-none");
        UI.elements.btnStopChart.classList.add("opacity-20", "pointer-events-none");
        UI.elements.btnClearChart.classList.remove("hidden");
        UI.elements.btnPauseChart.classList.add("hidden");
        UI.elements.btnContinueChart.classList.add("hidden");
        UI.elements.chartOverlayPause.classList.add("hidden");
        UI.elements.chartOverlayRun.classList.add("hidden");
        break;

      case CONSTANTS.CHART_STATUS.RENDERING:
        UI.elements.btnStartChart.classList.add("opacity-20", "pointer-events-none");
        UI.elements.btnStopChart.classList.remove("opacity-20", "pointer-events-none");
        UI.elements.btnClearChart.classList.add("hidden");
        UI.elements.btnPauseChart.classList.remove("hidden", "pointer-events-none");
        UI.elements.btnContinueChart.classList.add("hidden");
        UI.elements.chartOverlayPause.classList.add("hidden");
        UI.elements.chartOverlayRun.classList.remove("hidden", "pointer-events-none");
        break;
      case CONSTANTS.CHART_STATUS.PAUSING:
        UI.elements.btnStartChart.classList.add("opacity-20", "pointer-events-none");
        UI.elements.btnStopChart.classList.remove("opacity-20", "pointer-events-none");
        UI.elements.btnClearChart.classList.add("hidden");
        UI.elements.btnPauseChart.classList.add("hidden");
        UI.elements.btnContinueChart.classList.remove("hidden");
        UI.elements.chartOverlayPause.classList.remove("hidden");
        UI.elements.chartOverlayRun.classList.add("hidden");
        break;

      default:
        break;
    }
  }
  /**
   * Updates the UI for the File Logging section based on AppState.
   */

  setLoggingPanelVisible(isEnable) {
    if (isEnable) {
      this.elements.loggingConfigPanel.classList.remove("hidden");
    } else {
      this.elements.loggingConfigPanel.classList.add("hidden");
    }
  }

  setLoggingPanelStatus(loggingStatus) {
    switch (loggingStatus) {
      case CONSTANTS.LOGGING_FILE_STATUS.NONE:
        this.elements.setFolderLoggingBtn.classList.remove("hidden");
        this.elements.startFileLoggingBtn.classList.add("opacity-20", "pointer-events-none");
        this.elements.finishFileLoggingBtn.classList.add("opacity-20", "pointer-events-none");
        break;
      case CONSTANTS.LOGGING_FILE_STATUS.READY:
        this.elements.setFolderLoggingBtn.classList.add("hidden");
        this.elements.startFileLoggingBtn.classList.remove("opacity-20", "pointer-events-none");
        this.elements.finishFileLoggingBtn.classList.add("opacity-20", "pointer-events-none");
        break;
      case CONSTANTS.LOGGING_FILE_STATUS.LOGGING:
        this.elements.allowFileLoggingToggle.disabled = true;
        this.elements.startFileLoggingBtn.classList.add("opacity-20", "pointer-events-none");
        this.elements.finishFileLoggingBtn.classList.remove("opacity-20", "pointer-events-none");
        break;
      case CONSTANTS.LOGGING_FILE_STATUS.FINISH:
        this.elements.allowFileLoggingToggle.disabled = false;
        this.elements.startFileLoggingBtn.classList.remove("opacity-20", "pointer-events-none");
        this.elements.finishFileLoggingBtn.classList.add("opacity-20", "pointer-events-none");
        break;

      default:
        break;
    }
  }

  /**
   * Updates the UI for AutoFit Button in Chart
   */

  updateAutoFitButton(isAutoFit) {
    if (isAutoFit) {
      this.elements.btnAutoFit.classList.remove("bg-gray-600", "hover:bg-gray-500", "text-slate-300");
      this.elements.btnAutoFit.classList.add("bg-green-600", "hover:bg-green-500", "text-white");
    } else {
      this.elements.btnAutoFit.classList.remove("bg-green-600", "hover:bg-green-500", "text-white");
      this.elements.btnAutoFit.classList.add("bg-gray-600", "hover:bg-gray-500", "text-slate-300");
    }
  }

  /**
   * Updates the UI for Sensor Panel
   */

  updateSensorStatusUI(sensorStatus) {
    if (!Array.isArray(sensorStatus) || sensorStatus.length === 0) {
      console.warn("No sensor data to update");
      return;
    }
    for (let sensor of sensorStatus) {
      if (!sensor.name) continue;
      switch (sensor.name) {
        case "Stream status":
          // Change state of checkboxStreaming
          this.elements.checkboxStreaming.checked = sensor.active === "ON";
          // Manually trigger "change" event since setting checked programmatically doesn't fire it
          this.elements.checkboxStreaming.dispatchEvent(new Event("change", { bubbles: true }));
          break;
        case "hx712":
          this.elements.checkboxHX712.checked = sensor.active === "ON";
          this.elements.sdHX712.checked = sensor.enableSDcardLog === "ON";
          break;

        case "piezo":
          this.elements.checkboxPiezo.checked = sensor.active === "ON";
          this.elements.sdPiezo.checked = sensor.enableSDcardLog === "ON";
          break;

        case "ads1115":
          break;

        default:
          break;
      }
    }
  }
  resetSensorStatusPanel() {
    this.elements.checkboxStreaming.checked = false;
    this.elements.checkboxHX712.checked = false;
    this.elements.sdHX712.checked = false;
    this.elements.checkboxPiezo.checked = false;
    this.elements.sdPiezo.checked = false;
    // this.elements.btnStopChart.click(); // Stop chart
  }
}

// Export một instance duy nhất (Singleton Pattern)
/** @type {UIManager} */
export const UI = new UIManager();
