import { logger } from "./logger.js";
import { UI } from "./uiManager.js";
import BLE from "./bleManager.js";
import UART from "./uartManager.js";
import FILE_TRANSFER from "./fileTransferManager.js";
import STREAMING from "./streamingManager.js";
import { AppState } from "./appState.js";
import { CONSTANTS } from "./constants.js";
import CHART from "./chartManager.js";
import PARSER_STREAMING from "./parserStreaming.js";
import { DATA_SIM } from "./simulator/dataSimulation.js";
import { FILE_LOG_MANAGER } from "./fileLogManager.js";
import { UTILS } from "./utils.js";

// Kết quả hiển thị trong Console sẽ có dạng: 08:45:30 19/05/2026
// console.log("Thời gian load mới nhất:", new Date().toLocaleString('vi-VN'));

function isDeviceConnected() {
  if (AppState.connectionType === CONSTANTS.CONNECTION_TYPE.NONE) {
    logger.log("warning", "No device connected. Please connect to a device first.");
    return false;
  }
  return true;
}

async function updateUIwithDeviceMessage(text) {
  if (text.includes("Sensor Info:")) {
    const sensorStatus = await UTILS.parseSensorStatus(text);
    UI.updateSensorStatusUI(sensorStatus);
  }
}

function terminal_send(cmd) {
  if (!cmd) return;
  UI.elements.terminalInput.value = ""; // Clear terminal input

  switch (cmd.toLowerCase()) {
    case "clear":
      logger.clear();
      break;

    default:
      if (!isDeviceConnected()) {
        return;
      }
      logger.log("default", `> ${cmd}`); // In ra terminal output
      const parts = cmd.split(/\s+/);
      const cmd_1 = parts[0].toLowerCase();
      const connect_state = AppState.connectionType;
      switch (connect_state) {
        case CONSTANTS.CONNECTION_TYPE.UART:
          UART.sendFrame(0x01, cmd);
          break;
        case CONSTANTS.CONNECTION_TYPE.BLE:
          BLE.sendFrame(0x01, cmd);
          break;
        default:
          break;
      }
      break;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  //  Khởi tạo cấu trúc các phần tử UI
  UI.init();

  // Khởi tạo Chart Manager với canvas từ UI
  CHART.init(UI.elements.canvas);

  UI.updateChartControlUI(); // Cập nhật UI Chart ban đầu

  // Liên kết DOM của Terminal vào Logger Service
  if (UI.elements.terminalOutput) {
    logger.registerTerminal(UI.elements.terminalOutput);
    logger.clear();
    logger.log("success", 'System initialized. Click "START SCAN" to begin.');
  } else {
    console.error("Không tìm thấy thẻ #terminal trong HTML!");
  }

  //================= TERMINAL PANEL =================
  // Set callback for Clear Terminal button
  UI.elements.clearTerminalBtn?.addEventListener("click", () => {
    logger.clear();
  });

  // Set callback for Send Terminal button
  UI.elements.sendTerminalBtn.onclick = async () => {
    terminal_send(UI.elements.terminalInput.value.trim());
  };
  // Set callback for Terminal Input (Enter key)
  UI.elements.terminalInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      terminal_send(UI.elements.terminalInput.value.trim());
    }
  });

  //================= DEVICE INFO PANEL =================
  UI.elements.btnSyncTime.onclick = () => {
    const now = Math.floor(Date.now() / 1000);
    const cmd_set_current_time = `date -s @${now}`;
    terminal_send(cmd_set_current_time);
  };
  UI.elements.btnSyncTimezone.onclick = () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offsetMinutes = -new Date().getTimezoneOffset();
    const cmd_set_timezone = `timedatectl set-timezone @${offsetMinutes}`;
    terminal_send(cmd_set_timezone);
  };

  UI.elements.btnGetDate.onclick = () => {
    terminal_send("date");
  };
  UI.elements.btnGetMTU.onclick = () => {
    terminal_send("ble");
  };

  //================= BLE CONNECTION PANEL =================
  // Updat UI và AppState dựa trên trạng thái kết nối BLE
  BLE.onStatusChange((isConnected, deviceName = "", deviceId = "") => {
    UI.updateConnectionBLEStatus(isConnected, deviceName, deviceId);
    if (isConnected) {
      if (AppState.connectionType == CONSTANTS.CONNECTION_TYPE.UART) {
        UI.elements.disconnectUartBtn.click(); // Tự động ngắt UART nếu đang kết nối để tránh xung đột
      }
      AppState.setConnectionType(CONSTANTS.CONNECTION_TYPE.BLE);
    } else {
      if (AppState.connectionType == CONSTANTS.CONNECTION_TYPE.BLE) {
        AppState.setConnectionType(CONSTANTS.CONNECTION_TYPE.NONE);
      }
    }
  });
  // Set callback for BLE messages to log them in the terminal
  BLE.onMessageNotify((type = "info", text) => {
    logger.log(type, text);
  });
  // Set callback for BLE data reception to log incoming data to terminal
  BLE.onDataReceived((textData) => {
    logger.log("info", textData);
  });

  UI.elements.connectBLEBtn.onclick = async () => {
    try {
      logger.log("info", "Scanning...");
      await BLE.connect();
    } catch (err) {
      logger.log("warning", `BLE Connection error: ${err.message || err}`);
    }
  };

  UI.elements.disconnectBLEBtn.onclick = async () => {
    try {
      await BLE.disconnect();
    } catch (err) {
      logger.log("error", `BLE Disconnect error: ${err.message || err}`);
    }
  };

  //================= UART CONNECTION PANEL =================
  UI.elements.connectUartBtn.onclick = async () => {
    await UART.connect();
  };

  UI.elements.disconnectUartBtn.onclick = async () => {
    await UART.disconnect();
  };

  // Set callback functions for UART to update UI
  UART.onStatusChange((isConnected) => {
    if (isConnected) {
      if (AppState.connectionType == CONSTANTS.CONNECTION_TYPE.BLE) {
        UI.elements.disconnectBLEBtn.click(); // Tự động ngắt BLE nếu đang kết nối để tránh xung đột
      }
      UI.updateConnectionUartStatus(true);
      AppState.setConnectionType(CONSTANTS.CONNECTION_TYPE.UART);
      terminal_send("status"); // Gửi lệnh "status" để lấy thông tin trạng thái thiết bị
    } else {
      UI.updateConnectionUartStatus(false);
      if (AppState.connectionType == CONSTANTS.CONNECTION_TYPE.UART) {
        AppState.setConnectionType(CONSTANTS.CONNECTION_TYPE.NONE);
      }
    }
  });

  // Set callback for UART messages to log them in the terminal
  UART.onMessageNotify((type, text) => {
    logger.log(type, text);
  });

  // Set callback for UART data reception to log incoming data to terminal
  UART.onDataReceived((data) => {
    updateUIwithDeviceMessage(data);
    if (String(data).toUpperCase().includes("ERR")) {
      logger.log("error", data);
    } else {
      logger.log("info", data);
    }
  });

  // Set callback for sending a status of UART file transfer to FILE_TRANSFER module
  UART.onFileTransferStatus((info) => {
    FILE_TRANSFER.handleDeviceResponse(info);
  });

  // Set callback for sending a status of BLE file transfer to FILE_TRANSFER module
  BLE.onFileTransferStatus((info) => {
    FILE_TRANSFER.handleDeviceResponse(info);
  });
  //================= FILE TRANSFER PANEL =================

  UI.elements.fileInput.addEventListener("change", () => {
    const file = UI.elements.fileInput.files[0];
    if (!file) {
      UI.elements.fileName.textContent = "No file chosen";
      return;
    }
    UI.elements.fileStatus.textContent = `Selected: ${file.name} (${file.size} bytes)`;
    UI.elements.fileName.textContent = file.name;
  });

  UI.elements.sendFileBtn.onclick = async () => {
    FILE_TRANSFER.sendFile(UI.elements.fileInput.files[0], UI.elements.remoteSendDir?.value || "");
  };
  UI.elements.getFileBtn.onclick = async () => {
    const fileName = UI.elements.deviceFilePath.value.trim();

    // 1. Kiểm tra tên file trống trước
    if (!fileName) {
      alert("⚠️ Enter device file path/name");
      return;
    }

    let fileHandle;
    try {
      // Tách lấy tên file mặc định để gợi ý khi lưu
      const originalFileName = fileName.split("/").pop() || "download.bin";

      // Ask user to select save location BEFORE starting transfer (user gesture required)
      fileHandle = await window.showSaveFilePicker({
        suggestedName: originalFileName,
      });
    } catch (e) {
      // Nếu người dùng bấm "Cancel" (Hủy), trình duyệt sẽ ném ra lỗi AbortError
      if (e.name === "AbortError") {
        console.log("⚠️ Người dùng đã hủy chọn vị trí lưu file.");
      } else {
        console.error("Lỗi File Picker:", e);
        alert("❌ Không thể mở cửa sổ lưu file: " + e.message);
      }
      return; // Dừng lại, không chạy tiếp getFile nữa
    }

    // 3. Truyền cả fileName và fileHandle vào hàm getFile
    FILE_TRANSFER.getFile(fileName, fileHandle);
  };
  UI.elements.stopFileBtn.onclick = async () => {
    FILE_TRANSFER.stopTransfer();
  };

  FILE_TRANSFER.onMessageNotify((value) => {
    UI.elements.fileStatus.textContent = value;
  });

  FILE_TRANSFER.onUpdateProgress((percent, text) => {
    UI.elements.progressBar.style.width = percent;
    UI.elements.progressText.textContent = text;
  });
  FILE_TRANSFER.onStatusChange((value) => {
    UI.elements.stopFileBtn.classList.toggle("hidden", !value);
  });

  FILE_TRANSFER.onSendFrame((cmd, payload) => {
    if (AppState.connectionType === CONSTANTS.CONNECTION_TYPE.UART) {
      UART.sendFrame(cmd, payload);
    } else if (AppState.connectionType === CONSTANTS.CONNECTION_TYPE.BLE) {
      BLE.sendFrame(cmd, payload);
    }
  });

  //================= STREAMING ================= =======
  // Set callback for sending a status of streaming data to PARSER_STREAMING module
  UART.onStreamingStatus((info) => {
    PARSER_STREAMING.processStreamingData(info);
  });

  // Set callback when DATA_SIM has new data then we feed it to PARSER_STREAMING
  DATA_SIM.setupDemoType(DATA_SIM.DEMO_MODE.EXAMPLE_3);
  DATA_SIM.onDataGenerated = (info) => {
    PARSER_STREAMING.processStreamingData(info);
  };

  // Set callback when PARSER_STREAMING has new data
  PARSER_STREAMING.onNewStreamingData((result) => {
    // This plot simulation data from DATA_SIM
    if (AppState.chartStatus != CONSTANTS.CHART_STATUS.NONE) {
      // console.log("[NEW STREAMING DATA]", result);

      const samplingRate = result.samplingRate;
      const msOfMinuteFW = result.msOfMinuteFW;
      
      for (let i = 0; i < result.samples.length; i++) {
        const samples = result.samples[i];
        const channelName = "data_type_" + result.streamType + "_ch_" + i;
        CHART.addChartBuffer(samples, samplingRate, channelName, msOfMinuteFW);
      }
      const sensorName = "data_type_" + result.streamType;
      const sensorData = result.samples;
      FILE_LOG_MANAGER.addFileLogBuffer(sensorData, samplingRate, sensorName,msOfMinuteFW);
    }
  });

  UI.elements.checkboxStreaming.addEventListener("change", async () => {
    if (!isDeviceConnected()) {
      UI.elements.checkboxStreaming.checked = false;
      return;
    }
    const isStreaming = UI.elements.checkboxStreaming.checked;
    if (isStreaming) {
      STREAMING.startStreaming();
      UI.elements.btnStartChart.click();
    } else {
      STREAMING.stopStreaming();
      UI.elements.btnStopChart.click();
    }
  });

  STREAMING.onSendFrame((cmd, payload) => {
    UART.sendFrame(cmd, payload);
  });

  //================= CHART CONTROLS =================
  UI.elements.btnStartChart.onclick = async () => {
    AppState.setChartStatus(CONSTANTS.CHART_STATUS.RENDERING);
    CHART.start();
    // DATA_SIM.start(); // Start JS DATA simulation
  };

  UI.elements.btnStopChart.onclick = async () => {
    CHART.stop();
    AppState.setChartStatus(CONSTANTS.CHART_STATUS.NONE);
  };

  UI.elements.btnPauseChart.onclick = async () => {
    CHART.freezeCurrentView();
    AppState.setChartStatus(CONSTANTS.CHART_STATUS.PAUSING);
  };
  UI.elements.btnContinueChart.onclick = async () => {
    CHART.unfreeze();
    AppState.setChartStatus(CONSTANTS.CHART_STATUS.RENDERING);
  };

  UI.elements.btnClearChart.onclick = () => {
    CHART.clear();
  };
  // Fit the view to display all data currently available on the chart
  UI.elements.btnFitChart.onclick = () => {
    CHART.zoomToFitData();
  };

  // Toggle Auto Fit mode
  UI.elements.btnAutoFit.onclick = () => {
    CHART.toggleAutoFit();
  };

  // Sync UI state when Auto Fit mode changes
  CHART.onAutoFitChange((isValue) => {
    AppState.updateAutoFitState(isValue);
  });

  // ================== FILE LOGGING  =================
  UI.elements.allowFileLoggingToggle.addEventListener("change", async () => {
    const isAllowDirectStream = FILE_LOG_MANAGER.isDirectFileWriteAvailable();
    const allowRecord = UI.elements.allowFileLoggingToggle.checked;
    if (!isAllowDirectStream) {
      logger.log("error", "This browser does not support direct streaming of data to a file.");
      console.error("This browser does not support direct streaming of data to a file.");
      UI.elements.allowFileLoggingToggle.checked = false; // Disable Logging file module
      return;
    }
    if (!allowRecord) {
      AppState.setLoggingPanelVisible(false);
      AppState.setLoggingPanelStatus(CONSTANTS.LOGGING_FILE_STATUS.NONE);
      FILE_LOG_MANAGER.resetDirectory(); // Clear dirHandle. User must select folder again in next toggle ON
    } else {
      AppState.setLoggingPanelVisible(true);
      if (isAllowDirectStream) {
        AppState.loggingMode = CONSTANTS.LOGGING_MODE.DIRECT_STREAM;
        AppState.setLoggingPanelStatus(CONSTANTS.LOGGING_FILE_STATUS.NONE);
      } else {
        // TODO or NO NEED: - Save data in buffer. When finish we will download file to pc.
        AppState.loggingMode = CONSTANTS.LOGGING_MODE.BUFFERED_SAVE;
        AppState.setLoggingPanelStatus(CONSTANTS.LOGGING_FILE_STATUS.READY); // Ignore folder selection
      }
    }
  });

  // Set a file location to write data if browser support WRITE_FILE_DIRECTLY
  UI.elements.setFileLoggingBtn.onclick = async () => {
    try {
      const isOK = await FILE_LOG_MANAGER.initializeDirectory();
      if (!isOK) return;
      AppState.setLoggingPanelStatus(CONSTANTS.LOGGING_FILE_STATUS.READY);
    } catch (err) {
      if (err.name === "AbortError") {
        logger.log("warning", "File selection cancelled.");
        return;
      }
    }
  };

  UI.elements.startFileLoggingBtn.onclick = async () => {
    // Start File Logging module
    await FILE_LOG_MANAGER.start();
    // Update File Logging UI
    AppState.setLoggingPanelStatus(CONSTANTS.LOGGING_FILE_STATUS.LOGGING);
  };

  // Set State to FINISH and trigger file saving process in FILE_LOG_MANAGER
  UI.elements.finishFileLoggingBtn.onclick = async () => {
    // Finish the current loging file
    await FILE_LOG_MANAGER.finish();
    // Update File Logging UI
    AppState.setLoggingPanelStatus(CONSTANTS.LOGGING_FILE_STATUS.FINISH);
  };

  // Set callback for SAVE FILE MANAGER messages to log them in the terminal
  FILE_LOG_MANAGER.onMessageNotify = (type = "info", text) => {
    logger.log(type, text);
    UI.showToastNotification(type, text);
  };

  // ================== SENSOR  =================
  UI.elements.checkboxHX712.addEventListener("change", async () => {
    if (!isDeviceConnected()) {
      UI.elements.checkboxHX712.checked = false;
      return;
    }
    const isAllowSaveSDcard = UI.elements.sdHX712.checked ? 1 : 0;
    const isSensorEnabled = UI.elements.checkboxHX712.checked;
    if (isSensorEnabled) {
      terminal_send(`sensor hx712 1 40 31 ${isAllowSaveSDcard}`);
    } else {
      terminal_send(`sensor hx712 0`);
    }
  });

  UI.elements.checkboxPiezo.addEventListener("change", async () => {
    if (!isDeviceConnected()) {
      UI.elements.checkboxPiezo.checked = false;
      return;
    }
    const isAllowSaveSDcard = UI.elements.sdPiezo.checked ? 1 : 0;
    const isSensorEnabled = UI.elements.checkboxPiezo.checked;
    if (isSensorEnabled) {
      terminal_send(`sensor piezo 1 1000 31 ${isAllowSaveSDcard}`);
    } else {
      terminal_send(`sensor piezo 0`);
    }
  });

  UI.elements.checkboxADS1115.addEventListener("change", async () => {
    // TODO: Firmware Not implemented yet for ADS1115 sensor
    logger.log("warning", "ADS1115 sensor is not implemented yet in firmware.");
  });

  // End of DOMContentLoaded
});
