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

  /**
   * Parse streaming data frame from device.
   *
   * Frame: [type(1B)] [msOfMinute(2B)] [interleaved samples...]
   * Samples are stored as: samples[channel][sampleIndex]
   *
   * @param {Uint8Array} frame - Raw frame from device
   * @param {Object} config  Streaming configuration object with:
   * - config.channels - Number of channels
   * - config.sampleSize - Bytes/sample (1, 2, or 4)
   * - config.samplingRate - Sampling rate in Hz
   *
   * @returns {Promise<Object>} data - Parsed data with:
   *   - streamType: Stream type ID
   *   - perfTimeMs: performance.now() timestamp at parse time
   *   - unixTimeMs: Date.now() timestamp at parse time
   *   - msOfMinuteFW: Device millisecond counter (0-59999)
   *   - samplingRate: Sample frequency (Hz)
   *   - sampleCount: Samples per channel
   *   - samples: [[ch1_val_1,ch1_val_2,...],[ch2_val_2,ch2_val_2,...]]
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
    const perfTimeMs = Math.round(performance.now() * 10) / 10;

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

  /**
   * Parse streaming configuration from device data.
   *
   * Config format: [type(1B)] [channels(1B)] [samplingRate(2B)] [sampleSize(1B)]
   *
   * @param {Uint8Array} data - Raw config data from device
   * @returns {Object} Parsed "config" object:
   * - config.type - Stream type identifier
   * - config.typeName - Human-readable stream type name
   * - config.channels - Number of channels
   * - config.samplingRate - Sampling rate in Hz
   * - config.sampleSize - Bytes per sample (1, 2, or 4)
   */
  parseStreamingConfig(data) {
    if (data.length < 5) {
      throw new Error("Invalid streaming config");
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const type = view.getUint8(0);
    const config = {
      type,
      typeName: this.getStreamTypeName(type),
      channels: view.getUint8(1),
      samplingRate: view.getUint16(2, true),
      sampleSize: view.getUint8(4),
    };
    return config;
  }

  // Update the existing configuration for the given stream type,
  // or add it if it doesn't already exist.
  async updateStreamingConfig(config) {
    const existingIdx = this.configs.findIndex((c) => c.type === config.type);
    if (existingIdx >= 0) {
      this.configs[existingIdx] = config;
    } else {
      this.configs.push(config);
      // console.log("[ALL CONFIGS]", this.configs);
    }
  }

  // Update a configuration from the device status message,
  async updateStreamingConfigFromDeviceStatus(deviceStatus) {
    const dataTypes = deviceStatus.filter((s) => s.name && s.name.startsWith("data_type_"));
    for (let dataType of dataTypes) {
      const typeInfo = CONSTANTS.STREAM_TYPES[dataType.name];
      if (!typeInfo) continue;
      const type = typeInfo.id;
      if (!dataType.channels || !dataType.samplingRate || !dataType.sampleSize) {
        console.warn(`[STREAM] Missing config for ${dataType.name}`);
        continue;
      }
      const samplingRate = parseInt(dataType.samplingRate);
      const channels = parseInt(dataType.channels);
      const sampleSize = parseInt(dataType.sampleSize);

      const config = {
        type: type,
        typeName: typeInfo.name,
        channels: channels,
        samplingRate: samplingRate,
        sampleSize: sampleSize,
      };
      this.updateStreamingConfig(config);
    }
  }

  // Process incoming streaming data from the device.
  async processStreamingData(info) {
    const startTime = performance.now();
    const { cmd, data } = info;
    switch (cmd) {
      case 0x93: {
        const config = this.parseStreamingConfig(data);
        this.updateStreamingConfig(config);
        break;
      }
      case 0x92: {
        const streamType = data[0];
        const config = this.configs.find((c) => c.type === streamType);
        if (!config) {
          // console.warn(`[STREAM] No config for stream type ${streamType}`);
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

  // =============== HELPER FUNCTIONS ================
  getStreamTypeName(typeId) {
    for (const [key, info] of Object.entries(CONSTANTS.STREAM_TYPES)) {
      if (info.id === typeId) {
        return info.name;
      }
    }
    return "sensor";
  }
}

const PARSER_STREAMING = new ParserStreaming();

export default {
  onMessageNotify: (fn) => (PARSER_STREAMING.onMessageNotify = fn),
  onSendFrame: (fn) => (PARSER_STREAMING.onSendFrame = fn),
  onNewStreamingData: (fn) => (PARSER_STREAMING.onNewStreamingData = fn),
  processStreamingData: (info) => PARSER_STREAMING.processStreamingData(info),
  updateStreamingConfigFromDeviceStatus: (deviceStatus) =>
    PARSER_STREAMING.updateStreamingConfigFromDeviceStatus(deviceStatus),
};
