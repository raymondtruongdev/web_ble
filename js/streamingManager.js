import { AppState } from "./appState.js";
import { CONSTANTS } from "./constants.js";
class Streaming {
  constructor() {
    // ---------------------------------------------------------------------
    // UI callbacks (injected by caller)
    // ---------------------------------------------------------------------

    this.onSendFrame = () => {}; // Function to send a command to the device
    this.onMessageNotify = () => {}; //

    this.is_streaming = false;

    this.statusMap = {
      0x00: "OK",
      0x01: "IS_BUSY",
      0x02: "INV_INPUT_DATA",
      0x03: "PREPARE_MEMORY_FAILURE",
      0x04: "MEMORY_ALLOC_FAILURE",
    };

  };

  transferFailed(msg) {
    this.is_streaming = false;
    this.stopStreaming(false);
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

  async startStreaming() {
    const startPayload = new Uint8Array([0x2]);
    // startPayload.set(0x2, 0);
    await this.onSendFrame(0x10, startPayload);
    // const startResp = await this.waitForCmd(0x90, 5000);
    // if (!this.ensureAckOk(startResp, "streaming start")) return;
    this.is_streaming = true;
  }

  async stopStreaming() {
    const startPayload =  new Uint8Array([0x2]);
    // startPayload.set(0x2, 0);
    await this.onSendFrame(0x11, startPayload);
    this.is_streaming = false;
    // const startResp = await this.waitForCmd(0x91, 5000);
    // if (!this.ensureAckOk(startResp, "streaming stop")) return;
  }

  handleDeviceResponse() {
    if (cmd === 0x92 && this.is_streaming) {
      if (!data.length) {
        console.log("[Streaming][RX_PACK] Data invalid");
        return;
      }

      const ack = data[0];

      // Missing/out-of-order in stream mode: rewind sender chunk index from device hint
      // data format: [ack][missing_chunk_id_u16_le]
      if (ack !== 0x00 && data.length === 1) {
        this.transferFailed(`${context} failed: ${this.statusMap[ack] || `0x${ack.toString(16)}`}`);
        return;
      }

      if(data.length > 3)
      {
        let stream_type = data[0];
        let timestamp_ms = data[1] | (data[2] << 8);
        let streaming_time_second = timestamp_ms/1000;
        let streaming_time_ms     = (timestamp_ms - streaming_time_second*1000)%1000;
        const streaming_data = data.slice(3);

        let package_time = reconstructTimestamp(streaming_time_second, streaming_time_ms);

        console.log("[Streaming][RX_PACK] package type:", `0x${stream_type.toString(16).padStart(2, "0")}`);
        console.log(`[${getFormattedTime(package_time)}]`, "[STREAMING_DATA]", Array.from(streaming_data).map((b) => b.toString(16).padStart(2, "0")).join(" "),);
      }
      else
      {
        this.transferFailed(`Invalid device response length: header=${info.data_len}, actual=${data.length}`);
      }
      return;
    }
  }

  getFormattedTime(package_time) {
    const year = package_time.getFullYear();
    const month = String(package_time.getMonth() + 1).padStart(2, '0');
    const day = String(package_time.getDate()).padStart(2, '0');

    const hour = String(package_time.getHours()).padStart(2, '0');
    const minute = String(package_time.getMinutes()).padStart(2, '0');
    const second = String(package_time.getSeconds()).padStart(2, '0');

    const ms = String(package_time.getMilliseconds()).padStart(3, '0');

    return `${year}-${month}-${day} ${hour}:${minute}:${second}.${ms}`;
  }

  reconstructTimestamp(sec, ms, rxTime = new Date()) {
    let best = null;
    let bestDiff = Number.MAX_SAFE_INTEGER;

    // Search ±1 day around receive time
    for (let dayOffset = -1; dayOffset <= 1; dayOffset++) {
        for (let hour = 0; hour < 24; hour++) {
            for (let minute = 0; minute < 60; minute++) {

                const candidate = new Date(rxTime);

                candidate.setDate(candidate.getDate() + dayOffset);
                candidate.setHours(hour);
                candidate.setMinutes(minute);
                candidate.setSeconds(sec);
                candidate.setMilliseconds(ms);

                const diff = rxTime - candidate;

                // Packet should not come from the future
                if (diff >= 0 && diff < bestDiff) {
                    bestDiff = diff;
                    best = candidate;
                }
            }
        }
    }

    return best;
  }

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
      this.stopStreaming();
      return false;
    }
    return true;
  }

  waitForCmd(expectedCmd, timeout = 30000) {
    return new Promise((resolve, reject) => {
      this.waitingAckResolve = (info) => {
        console.log("[Streaming]RX Command:", `0x${info.cmd.toString(16).padStart(2, "0")}`);
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
};

const STREAMING = new Streaming();

export default {
  startStreaming: () => STREAMING.startStreaming(),
  stopStreaming: () => STREAMING.stopStreaming(),
  handleDeviceResponse: (info) => STREAMING.handleDeviceResponse(info),
  onMessageNotify: (fn) => (STREAMING.onMessageNotify = fn),
  onSendFrame: (fn) => (STREAMING.onSendFrame = fn),
};
