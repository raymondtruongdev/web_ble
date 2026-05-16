class FileTransfer {
  constructor() {
    /**
     *  Callback to update the notification message UI
     * @param {string} text - content to display in notification area
     */
    this.onMessageNotify = () => {}; //

    /**
     *  Callback to update the file transfer progress UI
     * @param {string} value -The progress value (e.g., "50%")
     * @param {string} text - content to display in progress text
     */
    this.onUpdateProgress = () => {};

    /**
     *  Callback to update the UART connection status UI
     * @param {boolean} value - The connection status (true:  transfering / false: not transfering)
     */
    this.onStatusChange = () => {};

    /**
     * Callback to send a command to the device.
     * @param {number} cmd - The command ID / Opcode (e.g., 0x09)
     * @param {Uint8Array} payload - The  data to send
     */
    this.onSendCommand = () => {}; // Function to send a command to the device

    // ==================== Define init variables ====================

    this.maxChunkSize = 8185; // per spec
    this.fileName = "";
    this.fileView = null;
    this.currentIndex = 0;
    this.sending = false;
    this.startTime = 0; // ★ NEW
    this.totalBytes = 0; // ★ NEW

    this.ackTimer = null;
    this.waitingAckResolve = null;
    this.waitingAckReject = null;

    this.value_progress = "0 %";
    this.text_progress = "Progress: 0% | Speed: 0 KB/s | ETA: 0s";

    // ACK status codes mapping
    this.statusMap = {
      0x00: { text: "OK", action: "continue" },
      0x01: { text: "CRC Error", action: "stop" },
      0x02: { text: "Invalid Length", action: "stop" },
      0x03: { text: "Create File Failure", action: "stop" },
      0x04: { text: "File already exists", action: "stop" },
      0x05: { text: "Write Error", action: "stop" },
      0x06: { text: "State is incorrect", action: "stop" },
      0x07: { text: "Failure to open file", action: "stop" },
      0x08: { text: "Failure to jump to end of file", action: "stop" },
      0x09: { text: "File not exist", action: "stop" },
      0x0a: { text: "Prepare data failure", action: "stop" },
    };
  }

  // ==================== FUNCTIONS ====================
  enableStop(enable) {
    this.onStatusChange(enable);
  }

  resetProgress() {
    this.value_progress = "0%";
    this.text_progress = "";
    this.onUpdateProgress(this.value_progress, this.text_progress);
  }

  updateProgress() {
    const sent = this.currentIndex;
    const total = this.totalBytes;
    const percent = (sent / total) * 100;

    const elapsedMs = performance.now() - this.startTime;
    const speedKB = (sent / elapsedMs).toFixed(2);
    const remainBytes = total - sent;
    const remainMs = remainBytes / (sent / elapsedMs);
    const remainSec = (remainMs / 1000).toFixed(2);

    this.value_progress = percent + "%";
    this.text_progress = `Progress: ${percent.toFixed(1)}% | Speed: ${speedKB} KB/s | ETA: ${remainSec}s`;
    this.onUpdateProgress(this.value_progress, this.text_progress);
  }

  /* ---------------- Send File to Device ---------------- */

  sendFile = async (file) => {
    if (!file) {
      this.onMessageNotify("⚠️ Please select a file first.");
      return;
    }

    // Validate filename size (max 100 bytes)
    if (file.name.length > 100) {
      this.onMessageNotify("⚠️ Filename too long (max 100 bytes)");
      return;
    }

    this.stopRequested = false;
    this.enableStop(true);

    this.fileName = file.name;
    const fileNameBytes = new TextEncoder().encode(this.fileName);

    if (fileNameBytes.length > 256) {
      this.onMessageNotify("❌ File name too long (max 256 bytes).");
      return;
    }

    const buf = await file.arrayBuffer();
    this.fileView = new Uint8Array(buf);
    this.currentIndex = 0;
    this.totalBytes = this.fileView.length;
    this.sending = true;

    try {
      // Step 1: Send filename (command 0x02)
      await this.onSendCommand(0x02, fileNameBytes);

      const ack = await this.waitForAck(3000);
      if (!this.validateResponse(ack, "filename")) {
        return;
      }
      this.totalBytes = this.fileView.length;
      this.startTime = performance.now();
      this.onMessageNotify(`Sending "${this.fileName}" file data (${this.totalBytes} bytes)...`);
      // Step 2: Send file data in chunks
      await this.sendFileData();
    } catch (e) {
      if (e === "timeout") {
        this.transferFailed("⏱ Timeout waiting for device response");
      } else {
        this.transferFailed("❌ Transfer error: " + e.message);
      }
    }
  };

  async sendFileData() {
    while (this.currentIndex < this.totalBytes && !this.stopRequested) {
      const remaining = this.totalBytes - this.currentIndex;
      const chunkSize = Math.min(remaining, this.maxChunkSize);
      const chunk = this.fileView.slice(this.currentIndex, this.currentIndex + chunkSize);

      // Determine command: 0x04 for last chunk, 0x03 for others
      const isLastChunk = this.currentIndex + chunkSize >= this.totalBytes;
      const command = isLastChunk ? 0x04 : 0x03;

      await this.onSendCommand(command, chunk);

      const ack = await this.waitForAck(3000);
      console.log(`Data chunk ACK (index ${this.currentIndex}):`, ack);
      if (!this.validateResponse(ack, "data chunk")) {
        return;
      }

      this.currentIndex += chunkSize;
      this.updateProgress();
    }

    if (this.currentIndex >= this.totalBytes) {
      this.finishTransfer();
    }
  }

  finishTransfer() {
    this.sending = false;
    this.enableStop(false);
    this.updateProgress();

    const sec = ((performance.now() - this.startTime) / 1000).toFixed(2);
    this.onMessageNotify(`✅ Transfer completed in ${sec}s (${this.totalBytes} bytes)`);
    alert(`Transfer complete!\nFile: ${this.fileName}\nSize: ${this.totalBytes} bytes\nTime: ${sec}s`);
  }

  /* ---------------- Get File from Device ---------------- */

  getFile = async (fileName, fileHandle) => {
    if (!fileName) {
      this.onMessageNotify("⚠️ Enter device file path/name");
      return;
    }

    // Validate filename size
    if (fileName.length > 100) {
      this.onMessageNotify("⚠️ Filename too long (max 100 bytes)");
      return;
    }

    if (!fileHandle) {
      this.onMessageNotify("❌ Không tìm thấy vị trí lưu file hợp lệ.");
      return;
    }

    this.enableStop(true);
    this.stopRequested = false;
    this.sending = true;
    this.resetProgress();
    this.startTime = performance.now();
    this.onMessageNotify(`Requesting file info for "${fileName}"...`);

    try {
      // Step 1: Verify file exists (command 0x06)
      await this.onSendCommand(0x06, new TextEncoder().encode(fileName));

      const fileInfo = await this.waitForAck(3000);

      if (!fileInfo || fileInfo.ack !== 0x00) {
        const entry = this.statusMap[fileInfo ? fileInfo.ack : 0x09];
        this.transferFailed(`❌ ${entry ? entry.text : "Unknown error"}`);
        return;
      }

      // Validate CRC
      if (!fileInfo.crcOk) {
        this.transferFailed("❌ CRC validation failed on file info");
        return;
      }

      // Parse file size (4 bytes, little-endian)
      if (!fileInfo.data || fileInfo.data.length < 4) {
        this.transferFailed("❌ Invalid file size data");
        return;
      }

      const sizeBytes = fileInfo.data;
      const fileSize = sizeBytes[0] | (sizeBytes[1] << 8) | (sizeBytes[2] << 16) | (sizeBytes[3] << 24);

      this.totalBytes = fileSize;
      this.currentIndex = 0;
      const downloadBuffer = new Uint8Array(fileSize);

      this.onMessageNotify(`Receiving "${fileName}" (${fileSize} bytes)...`);

      // Step 2: Request file data chunks (command 0x07)
      while (this.currentIndex < this.totalBytes && !this.stopRequested) {
        await this.onSendCommand(0x07, new Uint8Array());

        const chunkInfo = await this.waitForAck(3000);

        if (!chunkInfo) {
          this.transferFailed("❌ No chunk response from device");
          return;
        }

        // Check ACK code
        if (chunkInfo.ack !== 0x00) {
          const entry = this.statusMap[chunkInfo.ack];
          this.transferFailed(`❌ Device error: ${entry ? entry.text : "Unknown"}`);
          return;
        }

        // Validate CRC
        if (!chunkInfo.crcOk) {
          this.transferFailed("❌ CRC validation failed on data chunk");
          return;
        }

        // Append data to buffer
        const data = chunkInfo.data || new Uint8Array();
        downloadBuffer.set(data, this.currentIndex);
        this.currentIndex += data.length;

        this.updateProgress();
      }

      // Step 3: Download complete - save to pre-selected location
      if (this.currentIndex === this.totalBytes) {
        const sec = ((performance.now() - this.startTime) / 1000).toFixed(2);
        this.onMessageNotify(`✅ Download completed in ${sec}s (${this.totalBytes} bytes)`);

        // Save file to pre-selected location
        try {
          const writable = await fileHandle.createWritable();
          await writable.write(downloadBuffer);
          await writable.close();

          const originalFileName = fileName.split("/").pop() || "download.bin";
          alert(`File saved successfully!\nFile: ${originalFileName}\nSize: ${this.totalBytes} bytes\nTime: ${sec}s`);
          this.onMessageNotify(`✅ File saved: ${originalFileName} (${sec}s)`);
        } catch (e) {
          console.error("File save error:", e);
          this.onMessageNotify("❌ Failed to save file: " + e.message);
        }
      }
    } catch (e) {
      if (e === "timeout") {
        this.transferFailed("⏱ Timeout waiting for device response");
      } else {
        this.transferFailed("❌ Download error: " + e.message);
      }
    } finally {
      this.enableStop(false);
      this.sending = false;
    }
  };

  /* ---------------- Stop Transfer ---------------- */

  stopTransfer = async () => {
    if (!this.sending) return;

    const remaining = this.fileView.length - this.currentIndex;

    this.stopRequested = true;
    this.sending = false;

    // Cancel ACK timer
    if (this.ackTimer) {
      clearTimeout(this.ackTimer);
      this.ackTimer = null;
    }

    // Reject pending promise
    if (this.waitingAckReject) {
      this.waitingAckReject("stopped");
      this.waitingAckResolve = null;
      this.waitingAckReject = null;
    }

    // Send STOP command (0x09)
    try {
      await this.onSendCommand(0x09, new Uint8Array());
    } catch (e) {
      console.error("Failed to send STOP command:", e);
    }

    status = "🛑 Transfer stopped by user";
    // this.progressText.textContent = "Transfer aborted";
    this.text_progress = "Transfer aborted";
    onUpdateProgress(this.value_progress, this.text_progress);
    this.enableStop(false);
  };

  /* ---------------- Response Handling ---------------- */

  waitForAck(timeout = 30000) {
    return new Promise((resolve, reject) => {
      this.waitingAckResolve = resolve;
      this.waitingAckReject = reject;

      if (this.ackTimer) clearTimeout(this.ackTimer);

      this.ackTimer = setTimeout(() => {
        this.ackTimer = null;
        this.waitingAckResolve = null;
        this.waitingAckReject = null;
        reject("timeout");
      }, timeout);
    });
  }

  handleDeviceResponse(info) {
    if (this.stopRequested) return;

    if (this.ackTimer) {
      clearTimeout(this.ackTimer);
      this.ackTimer = null;
    }

    if (this.waitingAckResolve) {
      this.waitingAckResolve(info);
      this.waitingAckResolve = null;
      this.waitingAckReject = null;
    }
  }

  validateResponse(info, context) {
    if (!info) {
      this.transferFailed(`❌ No response from device (${context})`);
      return false;
    }

    // Check CRC validation
    if (info.crcOk === false) {
      this.transferFailed("❌ CRC validation failed");
      return false;
    }

    // Check ACK code
    const ack = info.ack;
    const entry = this.statusMap[ack];

    if (!entry) {
      this.transferFailed(`❌ Unknown ACK code: 0x${ack.toString(16)}`);
      return false;
    }

    if (entry.action !== "continue") {
      this.transferFailed(`❌ Device error: ${entry.text}`);
      return false;
    }

    return true;
  }

  /* ---------------- Error Handling ---------------- */

  transferFailed(msg) {
    this.sending = false;
    this.enableStop(false);
    this.onMessageNotify(msg);
    alert(msg);

    // Send reset command (0x0A) to device
    try {
      this.onSendCommand(0x0a, new Uint8Array());
      console.log("Sent reset command (0x0A) to device");
    } catch (e) {
      console.warn("Failed to send reset command (0x0A):", e);
    }
  }
}

const FILE_TRANSFER = new FileTransfer();
// Export public API for FILE_TRANSFER module
export default {
  sendFile: (file) => FILE_TRANSFER.sendFile(file),
  getFile: (fileName, fileHandle) => FILE_TRANSFER.getFile(fileName, fileHandle),
  stopTransfer: () => FILE_TRANSFER.stopTransfer(),
  handleDeviceResponse: (info) => FILE_TRANSFER.handleDeviceResponse(info),
  onMessageNotify: (fn) => (FILE_TRANSFER.onMessageNotify = fn),
  onUpdateProgress: (fn) => (FILE_TRANSFER.onUpdateProgress = fn),
  onStatusChange: (fn) => (FILE_TRANSFER.onStatusChange = fn),
  onSendCommand: (fn) => (FILE_TRANSFER.onSendCommand = fn),
};
