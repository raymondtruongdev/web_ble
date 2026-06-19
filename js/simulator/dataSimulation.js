class DataSimulation {
  constructor() {
    this.TIMER_TICK_DURATION_MS = 1000;
    this.MAGNITUDE_BASE = 1000;

    this.DEMO_MODE = {
      EXAMPLE_1: 1, // send 1 sensor with 1 channel
      EXAMPLE_2: 2, // send 1 sensor with 2 channel
      EXAMPLE_3: 3, // send 1 sensor (1 channel) + 1 sensor ( 2 channels)
    };

    this.demoType = this.DEMO_MODE.EXAMPLE_1; // Choose a way auto send data sensor

    this.timerId = null;
    this.isRunning = false;
    this.onDataGenerated = null;
    this.counter = 0;

    this.data = {
      isFirstTime1: true,
      dataType1: 0x01,
      sampleSize1: 2, // data sample size in byte
      batch_ts_1: 30000, // (ms) offset timestamp when generate data packet [0..60000]
      samplingRate1: 3000,
      configInfo1: null,
      frameInfo1: null,
      isFirstTime2: true,
      dataType2: 0x02,
      sampleSize2: 2, // data sample size in byte
      batch_ts_2: 45000, // (ms) offset timestamp when generate data packet [0..60000]
      samplingRate2: 5000,
      configInfo2: null,
      frameInfo2: null,
    };
    // init data
    this.data.isFirstTime1 = true;
    this.data.configInfo1 = this.generateConfigPacket1Channel();
    this.data.frameInfo1 = this.generateDataPacket1Channel();
    this.data.isFirstTime2 = true;
    this.data.configInfo2 = this.generateConfigPacket2Channel();
    this.data.frameInfo2 = this.generateDataPacket2Channel();
  }

  /**
   * Set up the demo mode for sensor data simulation
   * @param {number} value - Demo mode value (1, 2, or 3)
   *                        - 1: Simulate 1 sensor with 1 channel
   *                        - 2: Simulate 1 sensor with 2 channels
   *                        - 3: Simulate 2 sensors (1 channel + 2 channels)
   */
  setupDemoType(value) {
    this.demoType = value;
  }

  start() {
    this.counter = 0;
    if (this.timerId) return;
    this.isRunning = true;
    // Chạy mỗi 1000ms để dữ liệu đổ về mỗi giây
    this.timerId = setInterval(() => this.tick(), this.TIMER_TICK_DURATION_MS);
  }

  stop() {
    this.isRunning = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  tick() {
    if (!this.isRunning) return;
    switch (this.demoType) {
      case this.DEMO_MODE.EXAMPLE_1: {
        if (this.data.isFirstTime1) {
          this.onDataGenerated(this.data.configInfo1);
          this.data.isFirstTime1 = false;
        } else this.onDataGenerated(this.data.frameInfo1);
        break;
      }

      case this.DEMO_MODE.EXAMPLE_2: {
        if (this.data.isFirstTime2) {
          this.onDataGenerated(this.data.configInfo2);
          this.data.isFirstTime2 = false;
        } else this.onDataGenerated(this.data.frameInfo2);
        break;
      }

      case this.DEMO_MODE.EXAMPLE_3: {
        // (seconds) when start we only send 1 sensor; then send 2 sensors together
        const COUNTER_THRESHOLD = 3;
        if (this.counter < COUNTER_THRESHOLD) {
          if (this.data.isFirstTime2) {
            this.onDataGenerated(this.data.configInfo2);
            this.data.isFirstTime2 = false;
          } else this.onDataGenerated(this.data.frameInfo2);
        } else {
          if (this.data.isFirstTime1) {
            this.onDataGenerated(this.data.configInfo1);
            this.data.isFirstTime1 = false;
          } else this.onDataGenerated(this.data.frameInfo1);

          if (this.data.isFirstTime2) {
            this.onDataGenerated(this.data.configInfo2);
            this.data.isFirstTime2 = false;
          } else this.onDataGenerated(this.data.frameInfo2);
        }
        this.counter++;
        break;
      }
    }
  }

  generateConfigPacket1Channel() {
    const payload = new Uint8Array(5);
    let offset = 0;
    const channels = 1;
    payload[offset++] = this.data.dataType1;
    payload[offset++] = channels;
    payload[offset++] = this.data.samplingRate1 & 0xff;
    payload[offset++] = (this.data.samplingRate1 >> 8) & 0xff;
    payload[offset++] = this.data.sampleSize1;
    return {
      cmd: 0x93,
      data: payload,
      data_len: payload.length,
      crcOk: true,
    };
  }
  generateDataPacket1Channel() {
    const sinData1 = this.generateSinData(this.data.samplingRate1, this.MAGNITUDE_BASE);
    const payload = new Uint8Array(3 + sinData1.length * 2);
    let offset = 0;
    payload[offset++] = this.data.dataType1;
    payload[offset++] = this.data.batch_ts_1 & 0xff;
    payload[offset++] = (this.data.batch_ts_1 >> 8) & 0xff;

    const n = sinData1.length;
    for (let k = 0; k < n; k++) {
      const value1 = sinData1[k];
      payload[offset++] = value1 & 0xff; // Low byte
      payload[offset++] = (value1 >> 8) & 0xff; // High byte
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
    payload[offset++] = this.data.dataType2;
    payload[offset++] = channels;
    payload[offset++] = this.data.samplingRate2 & 0xff;
    payload[offset++] = (this.data.samplingRate2 >> 8) & 0xff;
    payload[offset++] = this.data.sampleSize2;
    return {
      cmd: 0x93,
      data: payload,
      data_len: payload.length,
      crcOk: true,
    };
  }
  generateDataPacket2Channel() {
    const sinData1 = this.generateSinData(this.data.samplingRate2, this.MAGNITUDE_BASE + 500);
    const sinData2 = this.generateSinData(this.data.samplingRate2, this.MAGNITUDE_BASE + 1000);
    const payload = new Uint8Array(3 + (sinData1.length + sinData2.length) * 2);
    let offset = 0;
    payload[offset++] = this.data.dataType2;
    payload[offset++] = this.data.batch_ts_2 & 0xff;
    payload[offset++] = (this.data.batch_ts_2 >> 8) & 0xff;

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
