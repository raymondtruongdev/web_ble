import { AppState } from "./appState.js";
import { CONSTANTS } from "./constants.js";
class ParserStreaming {
  constructor() {
    this.onSendFrame = () => {}; // Function to send a command to the device
    this.onMessageNotify = () => {}; //

    this.onNewStreamingData = () => {}; //

    this.configs = [];
    this.data = [];
    this.MAX_POINTS = 5000;
  }

  parseStreamingConfig(data) {
    if (data.length < 5) {
      throw new Error("Invalid streaming config");
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const typeMap = {
      0: "HX712",
      1: "PIEZO",
      2: "STREAMING_TEST",
    };
    const type = view.getUint8(0);
    return {
      type,
      typeName: typeMap[type] || "sensor",
      channels: view.getUint8(1),
      samplingRate: view.getUint16(2, true),
      sampleSize: view.getUint8(4),
    };
  }

  /**
   * Parse a streaming data frame received from the device.
   *
   * The frame format is:
   * - Byte 0      : stream type
   * - Byte 1..2   : milliseconds-of-minute when the firmware created the frame
   * - Remaining   : interleaved sample data
   *
   * @param {Uint8Array} frame - Raw frame received from the device.
   * @param {Object} config - Stream configuration.
   * @param {number} config.channels - Number of channels.
   * @param {number} config.sampleSize - Bytes per sample (1, 2, or 4).
   * @param {number} config.samplingRate - Sampling rate in Hz.
   *
   * @returns {Promise<Object>} Parsed streaming data.
   * @returns {number} returns.streamType - Stream type identifier.
   * @returns {number} returns.perfTimeMs - Monotonic timestamp from performance.now()
   *                                        when the frame was parsed.
   * @returns {number} returns.unixTimeMs - Unix timestamp in milliseconds from
   *                                        Date.now() when the frame was parsed.
   * @returns {number} returns.msOfMinuteFW - Milliseconds within the current minute
   *                                        (0..59999) recorded by the firmware
   *                                        when the frame was generated.
   *                                        This value is only used to check for missing data.
   * @returns {number} returns.samplingRate - Sampling rate in Hz.
   * @returns {number} returns.sampleCount - Number of samples per channel.
   * @returns {number[][]} returns.samples - Sample data organized as
   *                                         samples[channel][sampleIndex].
   */
  async parseStreamingFrame(frame, config) {
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const type = view.getUint8(0);
    const msOfMinuteFW = view.getUint16(1, true);
    const channels = config.channels;
    const sampleSize = config.sampleSize;
    const samplingRate = config.samplingRate;
    const payloadLength = frame.length - 3;
    const bytesPerSample = channels * sampleSize;

    // if (payloadLength % bytesPerSample !== 0) {
    //   throw new Error(`Invalid frame length: payload=${payloadLength}, bytesPerSample=${bytesPerSample}`);
    // }
    const sampleCount = Math.floor(payloadLength / bytesPerSample);

    // High-resolution elapsed time since page load.
    const perfTimeMs = performance.now();

    // Milliseconds since Unix Epoch (1970-01-01 UTC).
    // Example: 1782076609123 -> 2026-06-21 21:16:49.123 UTC
    const unixTimeMs = Date.now();

    // samples[ch][sampleIndex]
    const samples = Array.from({ length: channels }, () => new Array(sampleCount));
    let offset = 3;
    for (let sampleIdx = 0; sampleIdx < sampleCount; sampleIdx++) {
      for (let ch = 0; ch < channels; ch++) {
        let value;
        switch (sampleSize) {
          case 1:
            value = view.getInt8(offset);
            break;
          case 2:
            value = view.getInt16(offset, true);
            break;
          case 4:
            value = view.getInt32(offset, true);
            break;
          default:
            throw new Error(`Unsupported sample size: ${sampleSize}`);
        }

        samples[ch][sampleIdx] = value;
        offset += sampleSize;
      }
    }

    return {
      streamType: type,
      perfTimeMs: perfTimeMs,
      unixTimeMs: unixTimeMs,
      msOfMinuteFW: msOfMinuteFW, //  This value is only used to check for missing data.
      samplingRate: samplingRate,
      sampleCount,
      samples,
    };
  }

  getChannelData(sensorType, sensorName, channel) {
    let item = this.data.find((d) => d.sensorType === sensorType && d.channel === channel);
    if (!item) {
      item = {
        sensorType,
        sensorName,
        channel,
        values: [],
      };
      this.data.push(item);
    }
    return item;
  }

  async processStreamingData(info) {
    const startTime = performance.now();
    const { cmd, data } = info;
    switch (cmd) {
      case 0x93: {
        const config = this.parseStreamingConfig(data);
        const idx = this.configs.findIndex((c) => c.type === config.type);
        if (idx >= 0) {
          this.configs[idx] = config;
        } else {
          this.configs.push(config);
        }
        // console.log("[ALL CONFIGS]", this.configs);
        break;
      }
      case 0x92: {
        const streamType = data[0];
        const config = this.configs.find((c) => c.type === streamType);
        if (!config) {
          console.warn(`[STREAM] No config for stream type ${streamType}`);
          return;
        }
        const result = await this.parseStreamingFrame(data, config);
        // console.log("[STREAM DATA]", result);
        this.onNewStreamingData(result);
        break;
      }
      default:
      // console.log(`[UNKNOWN CMD] 0x${cmd.toString(16)}`);
    }
    const elapsedTime = performance.now() - startTime;
    // console.log(`processStreamingData took ${elapsedTime.toFixed(2)} ms`);

    return;
  }
}

const PARSER_STREAMING = new ParserStreaming();

export default {
  onMessageNotify: (fn) => (PARSER_STREAMING.onMessageNotify = fn),
  onSendFrame: (fn) => (PARSER_STREAMING.onSendFrame = fn),
  onNewStreamingData: (fn) => (PARSER_STREAMING.onNewStreamingData = fn),
  processStreamingData: (info) => PARSER_STREAMING.processStreamingData(info),
};
