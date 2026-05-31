class FileTransfer {
  constructor() {
    // ---------------------------------------------------------------------
    // UI callbacks (injected by caller)
    // ---------------------------------------------------------------------
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
     *  Callback to update Transfer status to UI
     * @param {boolean} value - The connection status (true:  transfering / false: not transfering)
     */
    this.onStatusChange = () => {};

    /**
     * Callback to send a command to the device.
     * @param {number} cmd - The command ID / Opcode (e.g., 0x09)
     * @param {Uint8Array} payload - The  data to send
     */
    this.onSendFrame = () => {}; // Function to send a command to the device

    // ---------------------------------------------------------------------
    // Common transfer state
    // ---------------------------------------------------------------------
    this.maxChunkSize = 228; // Must match device-side chunk size
    this.fileName = "";
    this.fileView = null;
    this.currentIndex = 0;
    this.sending = false;
    this.stopRequested = false;
    this.startTime = 0;
    this.totalBytes = 0;

    // ---------------------------------------------------------------------
    // Upload state (WebUI -> Device)
    // ---------------------------------------------------------------------
    this.uploadChunkId = 0;
    this.uploadTotalChunks = 0;
    this.uploadCrc = 0;
    this.no_free_chunks = 0;

    // "Monitor thread" style waiter for final upload result from device.
    // Device reports final write result by cmd 0x83.
    this.uploadFinalAckResolve = null;
    this.uploadFinalAckReject = null;
    this.uploadFinalAckTimer = null;

    // ---------------------------------------------------------------------
    // Download state (Device -> WebUI)
    // ---------------------------------------------------------------------
    this.downloadExpectedChunkId = 0;
    this.downloadBuffer = null;
    this.downloadFileHandle = null;
    this.downloadRemotePath = "";
    this.downloadResolve = null;
    this.downloadReject = null;

    // ---------------------------------------------------------------------
    // Generic single-command waiter
    // Used by start/stop/crc commands (0x82/0x84/0x86/0x87/0x88, etc.)
    // ---------------------------------------------------------------------
    this.ackTimer = null;
    this.waitingAckResolve = null;
    this.waitingAckReject = null;

    // ---------------------------------------------------------------------
    // Progress UI text
    // ---------------------------------------------------------------------
    this.value_progress = "0%";
    this.text_progress = "";

    // ---------------------------------------------------------------------
    // Device status code map
    // ---------------------------------------------------------------------
    this.statusMap = {
      0x00: "OK",
      0x01: "IS_BUSY",
      0x02: "INV_INPUT_DATA",
      0x03: "FREE_SPACE_NOT_ENOUGH",
      0x04: "CREATE_PATH_FAILURE",
      0x05: "CREATE_FILE_FAILURE",
      0x06: "FILE_NOT_EXISTED",
      0x07: "PREPARE_MEMORY_FAILURE",
      0x08: "MISSING_DATA_CHUNK",
      0x09: "OPEN_FILE_FAILURE",
      0x0a: "WRITE_FILE_FAILURE",
      0x0b: "READ_FILE_FAILURE",
      0x0c: "CRC_FAILURE",
    };
  }

  // Enable/disable STOP button in UI
  enableStop(enable) {
    this.onStatusChange(enable);
  }

  // Reset progress text for a new transfer
  resetProgress() {
    this.value_progress = "0%";
    this.text_progress = "";
    this.onUpdateProgress(this.value_progress, this.text_progress);
  }

  // Update progress/speed/ETA from current counters
  updateProgress() {
    const done = this.currentIndex;
    const total = this.totalBytes || 1;
    const percent = (done / total) * 100;

    const elapsedMs = Math.max(1, performance.now() - this.startTime);
    const speedKBs = done / 1024 / (elapsedMs / 1000);
    const remainBytes = Math.max(0, this.totalBytes - done);
    const remainSec = speedKBs > 0 ? remainBytes / 1024 / speedKBs : 0;

    this.value_progress = `${percent.toFixed(1)}%`;
    this.text_progress = `Progress: ${percent.toFixed(1)}% | Speed: ${speedKBs.toFixed(2)} KB/s | ETA: ${remainSec.toFixed(1)}s`;
    this.onUpdateProgress(this.value_progress, this.text_progress);
  }

  // CRC32 helper (same polynomial expected by firmware side)
  crc32(data) {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        const mask = -(crc & 1);
        crc = (crc >>> 1) ^ (0xedb88320 & mask);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  // Read ACK code from device response payload: data[0]
  getAckFromInfo(info) {
    const data = info?.data;
    if (!data || data.length < 1) return null;
    return data[0];
  }

  // -----------------------------------------------------------------------
  // Upload flow (WebUI -> Device)
  // 1) Send cmd 0x02 (start + path + total_chunks)
  // 2) Stream cmd 0x03 chunks continuously (no per-chunk wait)
  // 3) Wait final cmd 0x83 from device workqueue (OK/error)
  // 4) If final ACK OK -> send cmd 0x06 CRC compare (expect 0x86)
  // -----------------------------------------------------------------------
  async sendFile(file, remoteDir = "") {
    if (!file) {
      this.onMessageNotify("Please select a file first.");
      return;
    }

    this.stopRequested = false;
    this.enableStop(true);
    this.resetProgress();

    this.fileName = file.name;
    const normalizedDir = (remoteDir || "").trim();
    const fullRemotePath = normalizedDir ? `${normalizedDir.replace(/\/+$/, "")}/${this.fileName}` : this.fileName;

    const pathBytes = new TextEncoder().encode(fullRemotePath);
    if (pathBytes.length > 255) {
      this.transferFailed("Remote path too long.");
      return;
    }

    const buf = await file.arrayBuffer();
    this.fileView = new Uint8Array(buf);
    this.totalBytes = this.fileView.length;
    this.currentIndex = 0;
    this.uploadChunkId = 0;
    this.uploadTotalChunks = Math.ceil(this.totalBytes / this.maxChunkSize);
    this.uploadCrc = this.crc32(this.fileView);
    this.sending = true;

    try {
      // Build upload start payload: [path bytes][chunk_count_u32_le]
      const startPayload = new Uint8Array(pathBytes.length + 4);
      startPayload.set(pathBytes, 0);
      const n = this.totalBytes >>> 0;
      startPayload[pathBytes.length + 0] = n & 0xff;
      startPayload[pathBytes.length + 1] = (n >>> 8) & 0xff;
      startPayload[pathBytes.length + 2] = (n >>> 16) & 0xff;
      startPayload[pathBytes.length + 3] = (n >>> 24) & 0xff;

      // Step 1: start upload
      await this.onSendFrame(0x02, startPayload);
      const startResp = await this.waitForCmd(0x82, 5000);
      if (!this.ensureAckOk(startResp, "upload start")) return;

      this.startTime = performance.now();
      this.onMessageNotify(`Uploading: ${fullRemotePath}`);

      // Start background-style final ACK monitor (cmd 0x83)
      const finalAckPromise = this.waitForUploadFinalAck();
      finalAckPromise.catch(() => {}); // Prevent "Uncaught (in promise)" if we return before awaiting this promise

      console.log("Total chunks of file:", `0x${this.uploadTotalChunks.toString(16).padStart(2, "0")}`);
      file_transfer_data_loop: while (
        this.uploadChunkId < this.uploadTotalChunks &&
        !this.stopRequested &&
        this.sending
      ) {
        // Step 2: Get free chunk count from device and start streaming chunks without waiting ACK for each chunk
        await this.onSendFrame(0x08, startPayload);
        const startResp = await this.waitForCmd(0x88, 5000);
        if (!this.ensureAckOk(startResp, "upload start")) return;
        if (startResp.data.length < 2) {
          this.transferFailed("Invalid download start response");
          return;
        }
        var send_chunk_cnt = 0;
        this.no_free_chunks = startResp.data[1];

        console.log("no_free_chunks:", `0x${this.no_free_chunks.toString(16).padStart(2, "0")}`);
        if (this.no_free_chunks === 0) {
          await new Promise((resolve) => setTimeout(resolve, 50)); // Avoid busy loop when device has no free chunk
          continue;
        } else {
          while (send_chunk_cnt < this.no_free_chunks) {
            const offset = this.uploadChunkId * this.maxChunkSize;
            const chunk = this.fileView.slice(offset, Math.min(offset + this.maxChunkSize, this.totalBytes));

            // cmd 0x03 payload: [chunk_id_u16_le][chunk_data]
            const payload = new Uint8Array(2 + chunk.length);
            payload[0] = this.uploadChunkId & 0xff;
            payload[1] = (this.uploadChunkId >>> 8) & 0xff;
            payload.set(chunk, 2);

            console.log("Chunk ID:", `0x${this.uploadChunkId.toString(16).padStart(2, "0")}`);
            await this.onSendFrame(0x03, payload);

            send_chunk_cnt += 1;
            this.uploadChunkId += 1;
            this.currentIndex = Math.min(this.totalBytes, this.uploadChunkId * this.maxChunkSize);
            this.updateProgress();
            if (this.uploadChunkId === this.uploadTotalChunks || this.stopRequested || !this.sending) {
              break file_transfer_data_loop; // Break inner loop to check free chunk count again before sending more chunks
            }
          }
        }
      }
      console.log("Finish to send file. with size", `${this.totalBytes}`);
      if (this.stopRequested || !this.sending) return;

      // Step 3: wait final cmd 0x83 from device workqueue
      try {
        const finalInfo = await finalAckPromise;
        const finalAck = this.getAckFromInfo(finalInfo);
        if (finalAck === null) {
          this.transferFailed("Invalid upload final ACK payload");
          this.stopTransfer();
          return;
        }
        if (finalAck !== 0x00) {
          this.transferFailed(`Upload write failed: ${this.statusMap[finalAck] || `0x${finalAck.toString(16)}`}`);
          this.stopTransfer();
          return;
        }
      } catch (e) {
        if (e === "stopped") return;
        this.transferFailed(
          e === "timeout" ? "Timeout waiting for upload final ACK" : `Upload error: ${e?.message || e}`,
        );
        this.stopTransfer();
        return;
      }

      // Step 4: final ACK OK -> CRC compare cmd 0x06 / resp 0x86
      const crcPayload = new Uint8Array(4);
      crcPayload[0] = this.uploadCrc & 0xff;
      crcPayload[1] = (this.uploadCrc >>> 8) & 0xff;
      crcPayload[2] = (this.uploadCrc >>> 16) & 0xff;
      crcPayload[3] = (this.uploadCrc >>> 24) & 0xff;
      await this.onSendFrame(0x06, crcPayload);
      const crcResp = await this.waitForCmd(0x86, 5000);
      if (!this.ensureAckOk(crcResp, "check integrity")) return;

      this.finishTransfer(`Upload completed: ${this.fileName}`);
    } catch (e) {
      if (e === "stopped" || this.stopRequested) return;
      this.transferFailed(e === "timeout" ? "Timeout waiting device response" : `Upload error: ${e?.message || e}`);
    }
  }

  // -----------------------------------------------------------------------
  // Download flow (Device -> WebUI)
  // 1) Send cmd 0x04 start request
  // 2) Receive cmd 0x85 chunks and assemble local buffer
  // 3) Send cmd 0x06 CRC compare and verify cmd 0x86
  // 4) Save buffer to user-selected file handle
  // -----------------------------------------------------------------------
  async getFile(fileName, fileHandle) {
    if (!fileName) {
      this.onMessageNotify("Enter remote file path/name");
      return;
    }
    if (!fileHandle) {
      this.onMessageNotify("Invalid local save location.");
      return;
    }

    this.stopRequested = false;
    this.sending = true;
    this.enableStop(true);
    this.resetProgress();
    this.startTime = performance.now();

    this.downloadExpectedChunkId = 0;
    this.downloadRemotePath = fileName;
    this.downloadFileHandle = fileHandle;

    try {
      // Step 1: request download start
      await this.onSendFrame(0x04, new TextEncoder().encode(fileName));
      const startResp = await this.waitForCmd(0x84, 5000);
      if (!this.ensureAckOk(startResp, "download start")) return;

      // startResp payload: [ack][file_size_u32_le]
      if (!startResp.data || startResp.data.length < 5) {
        this.transferFailed("Invalid download start response");
        return;
      }

      this.totalBytes =
        startResp.data[1] | (startResp.data[2] << 8) | (startResp.data[3] << 16) | (startResp.data[4] << 24);
      console.log(
        "Total bytes to download:",
        `${this.totalBytes} (0x${this.totalBytes.toString(16).padStart(8, "0")})`,
      );
      this.onMessageNotify(`Downloading: ${fileName}`);

      this.currentIndex = 0;
      this.downloadBuffer = new Uint8Array(this.totalBytes);

      // Step 2: wait until handleDeviceResponse() receives all 0x85 chunks
      await new Promise((resolve, reject) => {
        this.downloadResolve = resolve;
        this.downloadReject = reject;
      });

      // Step 3: CRC compare
      const localCrc = this.crc32(this.downloadBuffer);
      const crcPayload = new Uint8Array(4);
      crcPayload[0] = localCrc & 0xff;
      crcPayload[1] = (localCrc >>> 8) & 0xff;
      crcPayload[2] = (localCrc >>> 16) & 0xff;
      crcPayload[3] = (localCrc >>> 24) & 0xff;
      await this.onSendFrame(0x06, crcPayload);
      const crcResp = await this.waitForCmd(0x86, 5000);
      if (!this.ensureAckOk(crcResp, "check integrity")) return;

      // Step 4: save to local file
      const writable = await fileHandle.createWritable();
      await writable.write(this.downloadBuffer);
      await writable.close();

      this.finishTransfer(`Download completed: ${fileName}`);
    } catch (e) {
      if (e === "stopped" || this.stopRequested) return;
      this.transferFailed(e === "timeout" ? "Timeout waiting device response" : `Download error: ${e?.message || e}`);
    }
  }

  // -----------------------------------------------------------------------
  // Stop transfer:
  // - mark transfer stopped
  // - cancel all pending waiters/timers (generic + upload monitor + download)
  // - send cmd 0x07 end process
  // -----------------------------------------------------------------------
  async stopTransfer() {
    if (!this.sending) return;

    this.stopRequested = true;
    this.sending = false;

    if (this.ackTimer) {
      clearTimeout(this.ackTimer);
      this.ackTimer = null;
    }
    if (this.waitingAckReject) {
      this.waitingAckReject("stopped");
      this.waitingAckResolve = null;
      this.waitingAckReject = null;
    }
    if (this.downloadReject) {
      this.downloadReject("stopped");
      this.downloadResolve = null;
      this.downloadReject = null;
    }
    if (this.uploadFinalAckTimer) {
      clearTimeout(this.uploadFinalAckTimer);
      this.uploadFinalAckTimer = null;
    }
    if (this.uploadFinalAckReject) {
      this.uploadFinalAckReject("stopped");
      this.uploadFinalAckResolve = null;
      this.uploadFinalAckReject = null;
    }

    try {
      const startPayload = new Uint8Array(2);
      startPayload[0] = 0x00; // dummy byte to indicate stop all transfers, no specific file path needed
      startPayload[1] = 0x00; // dummy byte to indicate stop all transfers, no specific file path needed
      await this.onSendFrame(0x07, startPayload);
      await this.waitForCmd(0x87, 2000);
    } catch (_) {}

    this.onMessageNotify("Transfer stopped");
    this.text_progress = "Transfer aborted";
    this.onUpdateProgress(this.value_progress, this.text_progress);
    this.enableStop(false);
  }

  // Wait for one specific command response (generic helper)
  waitForCmd(expectedCmd, timeout = 30000) {
    return new Promise((resolve, reject) => {
      this.waitingAckResolve = (info) => {
        console.log("[FST]RX Command:", `0x${info.cmd.toString(16).padStart(2, "0")}`);
        if (info?.cmd !== expectedCmd) return;
        resolve(info);
        this.waitingAckResolve = null;
        this.waitingAckReject = null;
      };
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

  // Waiter dedicated for upload final workqueue response (cmd 0x83)
  waitForUploadFinalAck() {
    return new Promise((resolve, reject) => {
      this.uploadFinalAckResolve = resolve;
      this.uploadFinalAckReject = reject;

      if (this.uploadFinalAckTimer) {
        clearTimeout(this.uploadFinalAckTimer);
        this.uploadFinalAckTimer = null;
      }
    });
  }

  // -----------------------------------------------------------------------
  // Device response router
  // - cmd 0x83: upload write pipeline result (final/error)
  // - cmd 0x85: download data chunk
  // - others: pass to generic waiter if one is active
  // -----------------------------------------------------------------------
  handleDeviceResponse(info) {
    if (!info || this.stopRequested) return;

    const cmd = Number.isFinite(info?.cmd) ? info.cmd : info?.command;
    if (!Number.isFinite(cmd)) {
      this.transferFailed("Invalid device response: missing command");
      return;
    }

    if (info.crcOk === false) {
      this.transferFailed("Frame CRC invalid");
      return;
    }

    const data = info.data instanceof Uint8Array ? info.data : new Uint8Array();
    if (Number.isFinite(info?.data_len) && info.data_len !== data.length) {
      this.transferFailed(`Invalid device response length: header=${info.data_len}, actual=${data.length}`);
      return;
    }

    // Upload monitor command (0x83)
    if (cmd === 0x83 && this.sending) {
      if (!data.length) {
        this.transferFailed("Invalid upload ACK frame");
        return;
      }

      const ack = data[0];

      // Missing/out-of-order in stream mode: rewind sender chunk index from device hint
      // data format: [ack][missing_chunk_id_u16_le]
      if (ack === 0x08 && data.length >= 3) {
        const missingChunkId = data[1] | (data[2] << 8);
        if (Number.isFinite(missingChunkId) && missingChunkId >= 0) {
          this.uploadChunkId = Math.min(missingChunkId, this.uploadTotalChunks);
          this.currentIndex = Math.min(this.totalBytes, this.uploadChunkId * this.maxChunkSize);
          this.updateProgress();
          this.onMessageNotify(`Resuming upload from missing chunk #${missingChunkId}`);
        }
        return;
      }

      // Resolve upload final waiter (ACK OK or ACK error)
      if (this.uploadFinalAckResolve) {
        this.uploadFinalAckResolve(info);
        this.uploadFinalAckResolve = null;
        this.uploadFinalAckReject = null;
        if (this.uploadFinalAckTimer) {
          clearTimeout(this.uploadFinalAckTimer);
          this.uploadFinalAckTimer = null;
        }
      }
      return;
    }

    // Download chunk command (0x85)
    if (cmd === 0x85 && this.sending && this.downloadBuffer) {
      if (data.length === 0x01) {
        const err = data[0];
        this.transferFailed(`Download chunk error: ${this.statusMap[err] || `0x${err.toString(16)}`}`);
        if (this.downloadReject) {
          this.downloadReject("device_error");
          this.downloadResolve = null;
          this.downloadReject = null;
        }
        return;
      }

      if (data.length < 2) {
        this.transferFailed("Invalid download chunk frame");
        return;
      }

      const chunkId = data[0] | (data[1] << 8);
      const chunkData = data.slice(2);
      console.log("Received chunk ID:", `0x${chunkId.toString(16).padStart(2, "0")}`, "Chunk size:", chunkData.length);
      // If chunk sequence mismatch, request resend pointer update by cmd 0x05
      if (chunkId !== this.downloadExpectedChunkId) {
        const miss = new Uint8Array(2);
        miss[0] = this.downloadExpectedChunkId & 0xff;
        miss[1] = (this.downloadExpectedChunkId >>> 8) & 0xff;
        this.onSendFrame(0x05, miss);
        return;
      }

      this.downloadBuffer.set(chunkData, this.currentIndex);
      this.currentIndex += chunkData.length;
      this.downloadExpectedChunkId += 1;
      this.updateProgress();

      // Signal getFile() when all bytes are received
      if (this.currentIndex >= this.totalBytes && this.downloadResolve) {
        this.downloadResolve(true);
        this.downloadResolve = null;
        this.downloadReject = null;
      }
    }

    // Generic waiter path (start/stop/crc responses)
    if (this.waitingAckResolve) {
      this.waitingAckResolve({ ...info, cmd, data });
      if (this.ackTimer) {
        clearTimeout(this.ackTimer);
        this.ackTimer = null;
      }
    }
  }

  // Validate device ACK payload and ensure ACK == OK
  ensureAckOk(info, context) {
    if (!info) {
      this.transferFailed(`No response (${context})`);
      return false;
    }

    const ack = this.getAckFromInfo(info);
    if (ack === null) {
      this.transferFailed(`Invalid ACK payload (${context})`);
      return false;
    }

    if (ack !== 0x00) {
      this.transferFailed(`${context} failed: ${this.statusMap[ack] || `0x${ack.toString(16)}`}`);
      if (!context.includes("check integrity") || !context.includes("integrity")) {
        this.stopTransfer();
      }
      return false;
    }
    return true;
  }

  // Mark transfer success and print duration/statistics
  finishTransfer(msg) {
    this.sending = false;
    this.enableStop(false);
    this.currentIndex = this.totalBytes;
    this.updateProgress();

    const sec = ((performance.now() - this.startTime) / 1000).toFixed(2);
    const message = `${msg} in ${sec}s (${this.totalBytes} bytes)`;
    this.onMessageNotify(message);
    this.showPopup(message);
  }

  // Mark transfer failure and notify UI
  transferFailed(msg) {
    this.sending = false;
    this.enableStop(false);
    this.onMessageNotify(msg);
    this.showPopup(msg);
  }

  // Show popup message for transfer result
  showPopup(message) {
    if (!message) return;

    if (typeof window !== "undefined" && typeof window.alert === "function") {
      window.alert(message);
    }
  }
}

const FILE_TRANSFER = new FileTransfer();

export default {
  sendFile: (file, remoteDir = "") => FILE_TRANSFER.sendFile(file, remoteDir),
  getFile: (fileName, fileHandle) => FILE_TRANSFER.getFile(fileName, fileHandle),
  stopTransfer: () => FILE_TRANSFER.stopTransfer(),
  handleDeviceResponse: (info) => FILE_TRANSFER.handleDeviceResponse(info),
  onMessageNotify: (fn) => (FILE_TRANSFER.onMessageNotify = fn),
  onUpdateProgress: (fn) => (FILE_TRANSFER.onUpdateProgress = fn),
  onStatusChange: (fn) => (FILE_TRANSFER.onStatusChange = fn),
  onSendFrame: (fn) => (FILE_TRANSFER.onSendFrame = fn),
};
