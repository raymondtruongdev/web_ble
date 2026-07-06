class UARTManager {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;

    this.no_package = 0;

    /**
     * Callback to notify a message from BLE manager
     * @param {string} type - Type of the message (e.g., "info", "warning", "error")
     * @param {string} text - Message text to display
     */
    this.onMessageNotify = () => {};

    /**
     * Callback to update UART connection status
     * @param {boolean} isConnected - state of the device connection
     */
    this.onStatusChange = () => {};

    /**
     * Callback to notify when new data is received from the UART device
     * @param {string} data - Message text get from UART
     */
    this.onDataReceived = () => {};

    /**
     * Callback to notify file transfer status updates from the UART device
     * @param {object} info - object contains status file transfer info, including:
     *   - cmd: command code from device (number)
     *   - data: raw payload data (Uint8Array)
     *   - data_len: length of the payload (number)
     *   - crcOk: boolean indicating if CRC check passed
     */
    this.onFileTransferStatus = () => {};

    /**
     * Callback to notify streaming status updates from the UART device
     * @param {object} info - object contains streaming status info, including:
     *   - cmd: command code from device (number)
     *   - data: raw payload data (Uint8Array)
     *   - data_len: length of the payload (number)
     */
    this.onStreamingStatus = () => {};
  }

  async connect() {
    try {
      this.port = await navigator.serial.requestPort();
      // baudRate: 1000000, 921600 , 460800 (max value for MACOS)
      await this.port.open({
        baudRate: 921600,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        hwFlowControl: true,
        bufferSize: 8192,
      });

      this.writer = this.port.writable.getWriter();

      this.no_package = 0;

      // Lắng nghe sự kiện hệ thống disconnect
      navigator.serial.addEventListener("disconnect", (event) => {
        if (event.port === this.port) {
          this.handleUnexpectedDisconnect();
        }
      });

      // KHÔNG sử dụng await ở đây để tránh chặn luồng kết nối
      this.readLoop();
      this.onMessageNotify("success", "UART Connected ✅");
      this.onStatusChange(true);
    } catch (err) {
      this.onMessageNotify("error", "UART Failed to connect: " + err.message);
    }
  }

  /** 🧼 Hàm dọn dẹp tài nguyên dùng chung (Đã sửa lỗi Async) */
  async _cleanup() {
    // 1. Giải phóng Writer
    if (this.writer) {
      try {
        this.writer.releaseLock();
      } catch (e) {
        console.error("Error releasing UART writer lock:", e);
      }
      this.writer = null;
    }

    // 2. Hủy/Giải phóng Reader một cách an toàn
    if (this.reader) {
      try {
        // Gọi cancel() để bẻ gãy luồng await reader.read() ở readLoop
        await this.reader.cancel();

        // KIỂM TRA LẠI: readLoop có thể đã nhảy vào `finally` và gán this.reader = null
        if (this.reader) {
          this.reader.releaseLock();
          this.reader = null; // Đánh dấu đã dọn dẹp xong
        }
      } catch (e) {
        console.error("Error releasing UART reader lock:", e);
      }
    }
  }

  /** 🔴 Hàm chủ động ngắt kết nối */
  async disconnect() {
    if (!this.port) {
      this.onMessageNotify("warning", "UART is already disconnected ❌");
      return;
    }

    try {
      // Chờ dọn dẹp xong luồng đọc/ghi
      await this._cleanup();

      // Đóng cổng vật lý
      await this.port.close();
      this.port = null;

      this.onStatusChange(false);
      this.onMessageNotify("warning", "UART disconnected ❌");
    } catch (err) {
      this.onMessageNotify("error", "UART Failed to disconnect: " + err.message);
    }
  }

  /** ⚠️ Xử lý khi mất kết nối phần cứng đột ngột */
  async handleUnexpectedDisconnect() {
    // Dọn dẹp luồng đọc/ghi
    await this._cleanup();
    this.port = null;

    this.onStatusChange(false);
    this.onMessageNotify("error", "UART is disconnected ❌");
  }

  calculateCRC16(data) {
    let crc = 0;
    const polynomial = 0x8005; // CRC-16-BUYPASS polynomial

    for (let i = 0; i < data.length; i++) {
      crc ^= data[i] << 8;
      for (let j = 0; j < 8; j++) {
        if (crc & 0x8000) {
          crc = (crc << 1) ^ polynomial;
        } else {
          crc = crc << 1;
        }
        crc &= 0xffff; // Keep 16 bits
      }
    }
    return crc;
  }

  /** 📨 Build and send frame (for file transfer with framing or terminal without framing) */
  async sendFrame(messageType, payload) {
    if (!this.writer) {
      console.error("Serial port not connected.");
      return;
    }

    if (typeof payload === "string") {
      payload = new TextEncoder().encode(payload);
    } else if (!(payload instanceof Uint8Array)) {
      payload = new Uint8Array(payload);
    }

    // For file transfer commands (0x02-0x0A), use framed format
    const MaxPayloadSize = 8185;
    if (payload.length > MaxPayloadSize) {
      throw new Error(`Payload size ${payload.length} exceeds maximum of ${MaxPayloadSize} bytes.`);
    }

    const startFrame = 0x01;
    const stopFrame = 0x04;
    const length = payload.length;

    // Construct frame: [start][type][len(2)][payload][crc(2)][stop]
    const frame = new Uint8Array(1 + 1 + 2 + length + 2 + 1);
    let offset = 0;
    frame[offset++] = startFrame;
    frame[offset++] = messageType;

    // Payload length (2 bytes, little-endian)
    frame[offset++] = length & 0xff;
    frame[offset++] = (length >> 8) & 0xff;
    frame.set(payload, offset);
    offset += length;

    // Calculate CRC16 from start frame to end of payload
    const crc = this.calculateCRC16(frame.slice(0, offset));

    // Add CRC16 (2 bytes, little-endian)
    frame[offset++] = crc & 0xff;
    frame[offset++] = (crc >> 8) & 0xff;
    frame[offset++] = stopFrame;

    console.log("TX Command:", `0x${messageType.toString(16).padStart(2, "0")}`);
    console.log("TX Payload length:", payload.length);
    // console.log(
    //   "TX Frame (hex):",
    //   Array.from(frame)
    //     .map((b) => b.toString(16).padStart(2, "0"))
    //     .join(" "),
    // );

    await this.writer.write(frame);
  }

  /** 📥 Handle frame from Device to WebUI
   * New format: [0x01][command][ack][lenL][lenH][payload...][crcL][crcH][0x04]
   * CRC calculated from command to end of payload
   */
  handleFrame(frame) {
    // Minimum frame: start(1) + command(1) + ack(1) + len(2) + crc(2) + stop(1) = 8 bytes
    if (!frame || frame.length < 8) {
      console.warn("Frame too short:", frame ? frame.length : 0);
      return;
    }

    if (frame[0] !== 0x01 || frame[frame.length - 1] !== 0x04) {
      console.warn(
        "Invalid frame markers. Start:",
        frame[0].toString(16),
        "End:",
        frame[frame.length - 1].toString(16),
      );
      return;
    }

    // Parse frame structure
    const command = frame[1]; // Command code
    const lenL = frame[2];
    const lenH = frame[3];
    const payloadLen = (lenH << 8) | lenL;
    // const ack = frame[4]; // ACK status code
    const payload = frame.slice(4, 4 + payloadLen);

    // console.log("Payload length:", `0x${payloadLen.toString(16).padStart(2, "0")}`);
    const expectedTotal = 1 + 1 + 2 + payloadLen + 2 + 1;
    if (frame.length !== expectedTotal) {
      console.warn("Frame length mismatch. Expected:", expectedTotal, "Got:", frame.length);
      return;
    }

    // Extract CRC
    const crcIndex = 4 + payloadLen;
    const crcL = frame[crcIndex];
    const crcH = frame[crcIndex + 1];
    const receivedCrc = (crcH << 8) | crcL;

    // Calculate CRC from command to end of payload
    // CRC range: frame[1] (command) to frame[4 + payloadLen] (last payload byte)
    const crcData = frame.slice(1, 4 + payloadLen);
    const crcCalc = this.calculateCRC16(crcData);
    const crcOk = (crcCalc & 0xffff) === (receivedCrc & 0xffff);

    // console.log(
    //   "RX Frame (hex):",
    //   Array.from(frame)
    //     .map((b) => b.toString(16).padStart(2, "0"))
    //     .join(" "),
    // );
    // console.log("RX Command:", `0x${command.toString(16).padStart(2, "0")}`);
    // console.log("RX ACK:", `0x${ack.toString(16).padStart(2, "0")}`);
    // console.log("RX Payload length:", payloadLen);
    // console.log(
    //   "RX CRC:",
    //   crcOk ? "✓ Valid" : "✗ Invalid",
    //   `(calc: 0x${crcCalc.toString(16).padStart(4, "0")}, recv: 0x${receivedCrc.toString(16).padStart(4, "0")})`,
    // );

    // Match firmware struct file_transfer_send_2_web_t ack layout:
    // ACK frame payload format from device is [code][data0][data1][data2][data3] for ACK type,
    // or raw payload for DATA type. We expose both cmd and command for compatibility.
    const info = {
      cmd: command,
      data: payload,
      data_len: payloadLen,
      crcOk,
    };
    // console.log("------------->New frame", performance.now().toFixed(1), info.data_len);
    //This means terminal display screen
    if (command === 0x81) {
      const decoder = new TextDecoder();
      const finalText = decoder.decode(new Uint8Array(payload));
      this.onDataReceived(finalText);
      return;
    }

    const filetransferCmds = new Set([0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89]);
    if (filetransferCmds.has(command)) {
      this.onFileTransferStatus(info);
      return;
    }

    const streamingCmds = new Set([0x91, 0x92, 0x93, 0x94]);
    if (streamingCmds.has(command)) {
      // console.log(
      //   "RX Payload (hex):",
      //   Array.from(payload)
      //   .map((b) => b.toString(16).padStart(2, "0"))
      //   .join(" "),
      // );
      if (command == 0x92) {
        console.log("========== DATA[0x92] package ID:", this.no_package, info.data_len);
        this.no_package++;
      }

      this.onStreamingStatus(info);
      return;
    }
  }

  discardAndResync(buffer) {
    const nextHeader = buffer.indexOf(0x01, 1);
    if (nextHeader >= 0) {
      this.onMessageNotify("warning", `Resync buffer: found new frame at offset ${nextHeader}`);
      return {
        buffer: buffer.slice(nextHeader),
        inFrame: true,
        expectedLength: null,
      };
    }
    this.onMessageNotify("warning", "Resync buffer: No new frame found, dropping buffer");
    return {
      buffer: [],
      inFrame: false,
      expectedLength: null,
    };
  }
  /** 📖 Read incoming data - length-based frame detection */
  async readLoop() {
    this.reader = this.port.readable.getReader();
    let buffer = [];
    let expectedLength = null;
    let inFrame = false;

    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value) continue;
        // console.log(
        //   "RX Data before validation (hex):",
        //   Array.from(value)
        //     .map((b) => b.toString(16).padStart(2, "0"))
        //     .join(" "),
        // );
        for (let byte of value) {
          if (byte === 0x01 && !inFrame) {
            // Start of new frame detected
            buffer = [byte];
            inFrame = true;
            expectedLength = null;
          } else if (inFrame) {
            // Accumulating frame bytes
            buffer.push(byte);

            // Once we have 5 bytes, calculate expected total length
            // Frame: [0x01][command][lenL][lenH][payload...][crcL][crcH][0x04]
            if (buffer.length === 4 && expectedLength === null) {
              const lenL = buffer[2];
              const lenH = buffer[3];
              const payloadLen = (lenH << 8) | lenL;

              if (payloadLen > 8185 || payloadLen === 0) {
                console.warn("Invalid payload length:", payloadLen, "Resetting frame buffer");
                const resync = this.discardAndResync(buffer);
                buffer = resync.buffer;
                inFrame = resync.inFrame;
                expectedLength = resync.expectedLength;
                continue;
              }

              // Total: start(1) + command(1) + ack(1) + len(2) + payload(payloadLen) + crc(2) + stop(1)
              expectedLength = 1 + 1 + 2 + payloadLen + 2 + 1;

              // Validate expected length (min 8 bytes, max 8192 bytes)
              if (expectedLength < 8 || expectedLength > 8192) {
                console.warn("Invalid frame length:", expectedLength, "Resetting frame buffer");
                const resync = this.discardAndResync(buffer);
                buffer = resync.buffer;
                inFrame = resync.inFrame;
                expectedLength = resync.expectedLength;
                continue;
              }
            }

            // Check if we've received the complete frame
            if (expectedLength !== null && buffer.length === expectedLength) {
              // Verify stop byte
              if (buffer[buffer.length - 1] === 0x04) {
                try {
                  this.handleFrame(new Uint8Array(buffer));
                } catch (e) {
                  console.error("handleFrame error:", e);
                }
              } else {
                const curEndByte = `0x${buffer[buffer.length - 1].toString(16).padStart(2, "0")}`;
                this.onMessageNotify("error", `Frame complete but missing stop byte (0x04). Got ${curEndByte}`);
                // Reset parser state
                buffer = [];
                inFrame = false;
                expectedLength = null;
                continue;
              }
              buffer = [];
              inFrame = false;
              expectedLength = null;
            }
          }
        }
      }
    } catch (err) {
      this.onMessageNotify("error", "UART read error: " + err.message);
    } finally {
      if (this.reader) {
        this.reader.releaseLock();
        this.reader = null;
      }
    }
  }
}

const UART = new UARTManager();
// Export public API for UART module
export default {
  connect: () => UART.connect(),
  disconnect: () => UART.disconnect(),
  sendCommand: (cmd) => UART.sendCommand(cmd),
  sendFrame: (cmd, payload) => UART.sendFrame(cmd, payload),

  onMessageNotify: (fn) => (UART.onMessageNotify = fn),
  onStatusChange: (fn) => (UART.onStatusChange = fn),
  onDataReceived: (fn) => (UART.onDataReceived = fn),
  onFileTransferStatus: (fn) => (UART.onFileTransferStatus = fn),
  onStreamingStatus: (fn) => (UART.onStreamingStatus = fn),
};
