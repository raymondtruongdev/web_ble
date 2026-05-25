import { logger } from "./logger.js";
import { UI } from "./uiManager.js";
import BLE from "./bleManager.js";
import UART from "./uartManager.js";
import FILE_TRANSFER from "./fileTransferManager.js";
import { AppState } from "./appState.js";
import { CONSTANTS } from "./constants.js";
import { PPG } from "./simulator/ppgSimulation.js";
import { CHART } from "./chartManager.js";
import { SaveFileManager } from "./saveFileManager.js";

// Kết quả hiển thị trong Console sẽ có dạng: 08:45:30 19/05/2026
// console.log("Thời gian load mới nhất:", new Date().toLocaleString('vi-VN'));

function terminal_send(cmd) {
  if (!cmd) return;
  UI.elements.terminalInput.value = ""; // Clear terminal input
  logger.log("default", `> ${cmd}`); // In ra terminal output

  switch (cmd.toLowerCase()) {
    case "clear":
      logger.clear();
      break;

    case "ppg start":
      PPG.startPPG(); // Start PPG data generation
      logger.log("success", "PPG simulation started.");
      break;

    case "ppg stop":
      PPG.stopPPG(); // Stop PPG data generation
      logger.log("success", "PPG simulation stopped.");
      break;
    case "ppg reset":
      PPG.resetPPG(); // Reset PPG data generation
      logger.log("success", "PPG simulation reset.");

      break;

    default:
      if (AppState.connectionType === CONSTANTS.CONNECTION_TYPE.NONE) {
        logger.log("warning", "No device connected. Please connect to a device first.");
        return;
      }
      const parts = cmd.split(/\s+/);
      const cmd_1 = parts[0].toLowerCase();
      const connect_state = AppState.connectionType;
      switch (connect_state) {
        case CONSTANTS.CONNECTION_TYPE.UART:
          UART.sendFrame(0x01, cmd);
          break;
        case CONSTANTS.CONNECTION_TYPE.BLE:
          BLE.sendCommand(cmd);
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

  UI.updateFileLoggingUI(); // Cập nhật UI FILE LOGGING PANEL ban đầu

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
  UART.onDataReceived((data) => logger.log("info", data));

  // Set callback for sending a status of UART file transfer to FILE_TRANSFER module
  UART.onFileTransferStatus((info) => {
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

  FILE_TRANSFER.onSendCommand((cmd, payload) => {
    UART.sendFrame(cmd, payload);
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

  //================= PPG SIMULATION =================
  // Kết nối dữ liệu từ Simulator sang Chart
  PPG.onDataGenerated = (samples) => {
    // Only update chart if in RENDERING state
    if (AppState.chartStatus === CONSTANTS.CHART_STATUS.RENDERING) {
      // Vẽ đường Sensor A (CH1)
      CHART.addDataPoints(samples, PPG.isRunning, PPG.lastDataGenTime, "ch1");

      // Vẽ đường Sensor B (CH2)
      const samplesCh2 = samples.map((s) => ({
        value: Math.max(0, Math.min(1000, s.value * 0.7 + 150)),
        timestamp: s.timestamp,
      }));
      CHART.addDataPoints(samplesCh2, PPG.isRunning, PPG.lastDataGenTime, "ch2");

      // Vẽ đường Sensor C (CH3)
      const samplesCh3 = samples.map((s) => ({
        value: Math.max(0, Math.min(1000, s.value * 0.3 + 250)),
        timestamp: s.timestamp,
      }));
      CHART.addDataPoints(samplesCh3, PPG.isRunning, PPG.lastDataGenTime, "ch3");
    }
    //Log the data to file
    if (CONSTANTS.LOGGING_FILE_STATUS.LOGGING === AppState.loggingStatus) {
      for (const sample of samples) {
        saveFileManager.write(sample.value, sample.timestamp);
      }
    }
  };
  //================= CHART CONTROLS =================
  CHART.setLabels("acc1", "acc2");

  UI.elements.btnStartChart.onclick = async () => {
    // Set Chart status to update Chart controls buttons state
    AppState.setChartStatus(CONSTANTS.CHART_STATUS.RENDERING);
    // Cập nhật trạng thái Chart để bắt đầu cuộn timeline ngay lập tức
    CHART.addDataPoints([], true, performance.now());
    // Trở lại chế độ vẽ thời gian thực
    CHART.unfreeze();
  };

  UI.elements.btnStopChart.onclick = async () => {
    AppState.setChartStatus(CONSTANTS.CHART_STATUS.NONE);
    // Cập nhật trạng thái Chart để dừng cuộn timeline tại mốc dữ liệu cuối cùng
    CHART.addDataPoints([], false, PPG.lastDataGenTime);
    CHART.unfreeze();
  };

  //Xoa dữ liệu trên Chart và reset về trạng thái ban đầu
  UI.elements.btnResetChart.onclick = () => {
    CHART.dataPoints = {}; // Xóa sạch tất cả các kênh động
    CHART.addDataPoints([], false, null);
  };

  // ================== FILE LOGGING  =================
  const saveFileManager = new SaveFileManager();
  UI.elements.allowFileLoggingToggle.addEventListener("change", async () => {
    const isAllowDirectStream = saveFileManager.check_allow_direct_stream_support();
    const allowRecord = UI.elements.allowFileLoggingToggle.checked;

    if (!allowRecord) {
      AppState.setLoggingMode(null);
      AppState.setLoggingStatus(CONSTANTS.LOGGING_FILE_STATUS.NONE);
    } else if (isAllowDirectStream) {
      AppState.setLoggingMode(CONSTANTS.LOGGING_MODE.DIRECT_STREAM);
      AppState.setLoggingStatus(CONSTANTS.LOGGING_FILE_STATUS.NONE);
      AppState.setLoggingFilename(null);
    } else {
      AppState.setLoggingMode(CONSTANTS.LOGGING_MODE.BUFFERED_SAVE);
      AppState.setLoggingStatus(CONSTANTS.LOGGING_FILE_STATUS.READY);
      return;
    }
  });

  // Set a file location to write data if browser support WRITE_FILE_DIRECTLY
  UI.elements.setFileLoggingBtn.onclick = async () => {
    try {
      const suggestedName = `data_${new Date().toISOString().replace(/T/, "_").slice(0, 19).replace(/:/g, "-")}.txt`;
      saveFileManager.start(suggestedName, PPG.sampleIntervalMs);
      AppState.setLoggingMode(CONSTANTS.LOGGING_MODE.WRITE_FILE_DIRECTLY);
      AppState.setLoggingFilename(saveFileManager.fileHandle?.name);
      AppState.setLoggingStatus(CONSTANTS.LOGGING_FILE_STATUS.READY);
    } catch (err) {
      if (err.name === "AbortError") {
        logger.log("warning", "File selection cancelled.");
        return;
      }
      AppState.setLoggingMode(CONSTANTS.LOGGING_MODE.WRITE_BUFFER);
      AppState.setLoggingFilename(null); //
      AppState.setLoggingStatus(CONSTANTS.LOGGING_FILE_STATUS.READY);
    }
  };

  // Set State to LOGGING FLAG to allow writing data
  UI.elements.startFileLoggingBtn.onclick = async () => {
    AppState.setLoggingStatus(CONSTANTS.LOGGING_FILE_STATUS.LOGGING);
  };

  // Set State to FINISH and trigger file saving process in SaveFileManager
  UI.elements.finishFileLoggingBtn.onclick = async () => {
    AppState.setLoggingStatus(CONSTANTS.LOGGING_FILE_STATUS.FINISH);
    saveFileManager.finish();
  };

  // Set callback for SAVE FILE MANAGER messages to log them in the terminal
  saveFileManager.onMessageNotify = (type = "info", text) => {
    logger.log(type, text);
    UI.showToastNotification(type, text);
  };

  // End of DOMContentLoaded
});
