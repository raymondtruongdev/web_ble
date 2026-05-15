export class SerialConnection {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.onStatusChange = () => {};
    this.onDataReceived = () => {};
    this.onFileTransferStatus = () => {};
  }

  async connect() {
    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 460800 }); // 921600 , 460800 (max value for MACOS)
      this.writer = this.port.writable.getWriter();
      this.readLoop();
      this.onStatusChange("Connected ✅");
    } catch (err) {
      this.onStatusChange("Failed to connect: " + err.message);
    }
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
    console.log(
      "TX Frame (hex):",
      Array.from(frame)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" "),
    );

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
    const ack = frame[2]; // ACK status code
    const lenL = frame[3];
    const lenH = frame[4];
    const payloadLen = (lenH << 8) | lenL;

    // Validate frame length
    // Total: start(1) + command(1) + ack(1) + len(2) + payload(payloadLen) + crc(2) + stop(1)
    const expectedTotal = 1 + 1 + 1 + 2 + payloadLen + 2 + 1;
    if (frame.length !== expectedTotal) {
      console.warn("Frame length mismatch. Expected:", expectedTotal, "Got:", frame.length);
      return;
    }

    // Extract payload
    const payload = frame.slice(5, 5 + payloadLen);

    // Extract CRC
    const crcIndex = 5 + payloadLen;
    const crcL = frame[crcIndex];
    const crcH = frame[crcIndex + 1];
    const receivedCrc = (crcH << 8) | crcL;

    // Calculate CRC from command to end of payload
    // CRC range: frame[1] (command) to frame[4 + payloadLen] (last payload byte)
    const crcData = frame.slice(1, 5 + payloadLen);
    const crcCalc = this.calculateCRC16(crcData);
    const crcOk = (crcCalc & 0xffff) === (receivedCrc & 0xffff);

    console.log(
      "RX Frame (hex):",
      Array.from(frame)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" "),
    );
    console.log("RX Command:", `0x${command.toString(16).padStart(2, "0")}`);
    console.log("RX ACK:", `0x${ack.toString(16).padStart(2, "0")}`);
    console.log("RX Payload length:", payloadLen);
    console.log(
      "RX CRC:",
      crcOk ? "✓ Valid" : "✗ Invalid",
      `(calc: 0x${crcCalc.toString(16).padStart(4, "0")}, recv: 0x${receivedCrc.toString(16).padStart(4, "0")})`,
    );

    const info = {
      command,
      ack,
      data: payload,
      crcOk,
    };

    // Pass to file transfer handler
    if (this.onFileTransferStatus) {
      this.onFileTransferStatus(info);
    }
  }

  /** 📖 Read incoming data - length-based frame detection */
  async readLoop() {
    const reader = this.port.readable.getReader();
    let buffer = [];
    let expectedLength = null;
    let inFrame = false;
    let asciiBuffer = [];
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        // console.log("RX Data before validation (hex):", Array.from(value).map(b => b.toString(16).padStart(2, "0")).join(" "));
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
            // Frame: [0x01][command][ack][lenL][lenH][payload...][crcL][crcH][0x04]
            if (buffer.length === 5 && expectedLength === null) {
              const lenL = buffer[3];
              const lenH = buffer[4];
              const payloadLen = (lenH << 8) | lenL;
              // Total: start(1) + command(1) + ack(1) + len(2) + payload(payloadLen) + crc(2) + stop(1)
              expectedLength = 1 + 1 + 1 + 2 + payloadLen + 2 + 1;

              // Validate expected length (min 8 bytes, max 8192 bytes)
              if (expectedLength < 8 || expectedLength > 8192) {
                console.warn("Invalid frame length:", expectedLength, "Resetting frame buffer");
                buffer = [];
                inFrame = false;
                expectedLength = null;
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
                console.warn(
                  "Frame complete but missing stop byte (0x04). Got:",
                  buffer[buffer.length - 1].toString(16),
                );
              }
              buffer = [];
              inFrame = false;
              expectedLength = null;
            }
          } else {
            // Not in a frame - regular ASCII character (terminal data)
            // const text = decoder.decode(Uint8Array.of(byte));
            // this.onDataReceived(text);
            // Not in a frame - accumulate ASCII bytes
            asciiBuffer.push(byte);

            // Detect end of message (newline)
            if (byte === 0x0a || byte === 0x0d) {
              const finalText = decoder.decode(new Uint8Array(asciiBuffer));
              this.onDataReceived('info',finalText);
              asciiBuffer = [];
            }
          }
        }
      }
    } catch (err) {
      this.onStatusChange("error","Read error: " + err.message);
    } finally {
      reader.releaseLock();
    }
  }
}
