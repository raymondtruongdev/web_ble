import { logger } from "./logger.js";
import { UI } from "./uiManager.js";
import BLE from "./bleManager.js";
import UART from "./uartManager.js";
import FILE_TRANSFER from "./fileTransferManager.js";
import { AppState } from "./appState.js";
import { CONNECTION_TYPE } from "./constants.js";

// Kết quả hiển thị trong Console sẽ có dạng: 08:45:30 19/05/2026
// console.log("Thời gian load mới nhất:", new Date().toLocaleString('vi-VN'));

function terminal_send(cmd) {
  if (!cmd) return;
  UI.elements.terminalInput.value = ""; // Clear terminal input
  logger.log("default", `> ${cmd}`); // In ra terminal output

  const parts = cmd.split(/\s+/);
  const cmd_1 = parts[0].toLowerCase();

  switch (cmd_1) {
    case "clear":
      logger.clear();
      break;

    default:
      const connect_state = AppState.connectionType;
      switch (connect_state) {
        case CONNECTION_TYPE.UART:
          UART.sendFrame(0x01, cmd);
          break;
        case CONNECTION_TYPE.BLE:
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

  // Liên kết DOM của Terminal vào Logger Service
  if (UI.elements.terminalOutput) {
    logger.registerTerminal(UI.elements.terminalOutput);
    logger.clear();
    logger.log("success", 'System initialized. Click "START SCAN" to begin.');
  } else {
    console.error("Không tìm thấy thẻ #terminal trong HTML!");
  }

  //================= TERMINAL UI =================
  // Set callback for Clear Terminal button
  if (UI.elements.clearTerminalBtn) {
    UI.elements.clearTerminalBtn.onclick = () => {
      logger.clear();
    };
  }
  // Set callback for Terminal Input (Enter key)
  if (UI.elements.terminalInput) {
    UI.elements.terminalInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        terminal_send(UI.elements.terminalInput.value.trim());
      }
    });
  }
  // Set callback for Send Terminal button
  if (UI.elements.sendTerminalBtn) {
    UI.elements.sendTerminalBtn.onclick = async () => {
      terminal_send(UI.elements.terminalInput.value.trim());
    };
  }

  //================= BLE CONNECTION =================
  // Updat UI và AppState dựa trên trạng thái kết nối BLE
  BLE.onStatusChange((isConnected, deviceName = "", deviceId = "") => {
    UI.updateConnectionBLEStatus(isConnected, deviceName, deviceId);
    if (isConnected) {
      if (AppState.connectionType == CONNECTION_TYPE.UART) {
        UI.elements.disconnectUartBtn.click(); // Tự động ngắt UART nếu đang kết nối để tránh xung đột
      }
      AppState.setConnectionType(CONNECTION_TYPE.BLE);
    } else {
      if (AppState.connectionType == CONNECTION_TYPE.BLE) {
        AppState.setConnectionType(CONNECTION_TYPE.NONE);
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

  if (UI.elements.connectBLEBtn) {
    UI.elements.connectBLEBtn.onclick = async () => {
      try {
        logger.log("info", "Scanning...");
        await BLE.connect();
      } catch (err) {
        logger.log("warning", `BLE Connection error: ${err.message || err}`);
      }
    };
  }

  if (UI.elements.disconnectBLEBtn) {
    UI.elements.disconnectBLEBtn.onclick = async () => {
      try {
        await BLE.disconnect();
      } catch (err) {
        logger.log("error", `BLE Disconnect error: ${err.message || err}`);
      }
    };
  }

  //================= UART CONNECTION =================
  if (UI.elements.connectUartBtn) {
    UI.elements.connectUartBtn.onclick = async () => {
      await UART.connect();
    };
  }

  if (UI.elements.disconnectUartBtn) {
    UI.elements.disconnectUartBtn.onclick = async () => {
      await UART.disconnect();
    };
  }

  // Set callback functions for UART to update UI
  UART.onStatusChange((isConnected) => {
    if (isConnected) {
      if (AppState.connectionType == CONNECTION_TYPE.BLE) {
        UI.elements.disconnectBLEBtn.click(); // Tự động ngắt BLE nếu đang kết nối để tránh xung đột
      }
      UI.updateConnectionUartStatus(true);
      AppState.setConnectionType(CONNECTION_TYPE.UART);
    } else {
      UI.updateConnectionUartStatus(false);
      if (AppState.connectionType == CONNECTION_TYPE.UART) {
        AppState.setConnectionType(CONNECTION_TYPE.NONE);
      }
    }
  });
  UART.onMessageNotify((type, text) => {
    logger.log(type, text);
  });
  // Set callback for UART data reception to log incoming data to terminal
  UART.onDataReceived((data) => logger.log("info", data));

  // Set callback for sending a status of UART file transfer to FILE_TRANSFER module
  UART.onFileTransferStatus((info) => {
    FILE_TRANSFER.handleDeviceResponse(info);
  });

  //================= FILE TRANSFER =================

  UI.elements.fileInput.addEventListener("change", () => {
    const file = UI.elements.fileInput.files[0];
    if (!file) {
      UI.elements.fileName.textContent = "No file chosen";
      return;
    }
    UI.elements.fileStatus.textContent = `Selected: ${file.name} (${file.size} bytes)`;
    UI.elements.fileName.textContent = file.name;
  });

  if (UI.elements.sendFileBtn) {
    UI.elements.sendFileBtn.onclick = async () => {
      FILE_TRANSFER.sendFile(UI.elements.fileInput.files[0]);
    };
  }
  if (UI.elements.getFileBtn) {
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
  }
  if (UI.elements.stopFileBtn) {
    UI.elements.stopFileBtn.onclick = async () => {
      FILE_TRANSFER.stopTransfer();
    };
  }

  FILE_TRANSFER.onSendCommand;

  FILE_TRANSFER.onMessageNotify((value) => {
    UI.elements.fileStatus.textContent = value;
  });

  FILE_TRANSFER.onUpdateProgress((percent, text) => {
    UI.elements.progressBar.style.width = percent;
    UI.elements.progressText.textContent = text;
  });
  FILE_TRANSFER.onStatusChange((value) => {
    UI.elements.stopFileBtn.classList.toggle("hidden", !value);
    // UI.elements.progressContainer.classList.toggle("hidden", !value);
  });

  FILE_TRANSFER.onSendCommand((cmd, payload) => {
    UART.sendFrame(cmd, payload);
  });

  // END
});
