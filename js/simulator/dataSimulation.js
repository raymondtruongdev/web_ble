class DataSimulation {
  constructor() {
    this.type = 0x02; // Uint8
    this.samplingRate = 5000; // Uint16
    this.sampleSize = 2; // Uint8

    this.N_SAMPLE = 5000;
    this.magnitude = 1000;
    this.batch_ts = 60000 / 1;

    this.DEMO_TYPE = 2; // 1: data have 1 channel; 2: data have 2

    this.timerId = null;
    this.isRunning = false;
    this.isFristimeStart = true;
    this.onDataGenerated = null;
  }

  startGenerate() {
    if (this.DEMO_TYPE == 1) {
      this.configInfo = this.generateConfigPacket();
      this.frameInfo = this.generateDataPacket();
    }
    if (this.DEMO_TYPE == 2) {
      this.configInfo = this.generateConfigPacket2Channel();
      this.frameInfo = this.generateDataPacket2Channel();
    }

    if (this.timerId) return;
    this.isRunning = true;
    // Chạy mỗi 1000ms để dữ liệu đổ về mỗi giây
    this.timerId = setInterval(() => this.tick(), 1000);
  }
  stopGenerate() {
    this.isRunning = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  tick() {
    if (!this.isRunning) return;
    if (this.isFristimeStart) {
      this.onDataGenerated(this.configInfo);
      this.isFristimeStart = false;
    } else this.onDataGenerated(this.frameInfo);
  }

  generateConfigPacket() {
    const payload = new Uint8Array(5);
    let offset = 0;
    const channels = 2;
    payload[offset++] = this.type;
    payload[offset++] = channels;
    payload[offset++] = this.samplingRate & 0xff;
    payload[offset++] = (this.samplingRate >> 8) & 0xff;
    payload[offset++] = this.sampleSize;
    return {
      cmd: 0x93,
      data: payload,
      data_len: payload.length,
      crcOk: true,
    };
  }
  generateDataPacket() {
    const sinData = this.generateSinData(this.N_SAMPLE, this.magnitude);
    const payload = new Uint8Array(3 + sinData.length * 2);
    let offset = 0;
    payload[offset++] = this.type;
    payload[offset++] = this.batch_ts & 0xff;
    payload[offset++] = (this.batch_ts >> 8) & 0xff;
    for (const value of sinData) {
      payload[offset++] = value & 0xff; // Low byte
      payload[offset++] = (value >> 8) & 0xff; // High byte
    }
    return {
      cmd: 0x92,
      data: payload,
      data_len: payload.length,
      crcOk: true,
    };
  }

  generateConfigPacket2Channel() {
    const payload = new Uint8Array(5);
    let offset = 0;
    const channels = 2;
    payload[offset++] = this.type;
    payload[offset++] = channels;
    payload[offset++] = this.samplingRate & 0xff;
    payload[offset++] = (this.samplingRate >> 8) & 0xff;
    payload[offset++] = this.sampleSize;
    return {
      cmd: 0x93,
      data: payload,
      data_len: payload.length,
      crcOk: true,
    };
  }
  generateDataPacket2Channel() {
    const sinData1 = this.generateSinData(this.N_SAMPLE, this.magnitude);
    const sinData2 = this.generateSinData(this.N_SAMPLE, this.magnitude + 500);
    const payload = new Uint8Array(3 + (sinData1.length + sinData2.length) * 2);
    let offset = 0;
    payload[offset++] = this.type;
    payload[offset++] = this.batch_ts & 0xff;
    payload[offset++] = (this.batch_ts >> 8) & 0xff;

    const n = sinData1.length;
    for (let k = 0; k < n; k++) {
      const value1 = sinData1[k];
      const value2 = sinData2[k];
      payload[offset++] = value1 & 0xff; // Low byte
      payload[offset++] = (value1 >> 8) & 0xff; // High byte
      payload[offset++] = value2 & 0xff; // Low byte
      payload[offset++] = (value2 >> 8) & 0xff; // High byte
    }
    return {
      cmd: 0x92,
      data: payload,
      data_len: payload.length,
      crcOk: true,
    };
  }

  generateSinData(numSamples = 10, magnitude = 100) {
    const data = new Int16Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      const angle = (2 * Math.PI * i) / (numSamples - 1);
      data[i] = Math.round(magnitude * Math.sin(angle));
    }
    return data;
  }
}

export const DATA_SIM = new DataSimulation();
