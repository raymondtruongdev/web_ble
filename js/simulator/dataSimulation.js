class DataSimulation {
  constructor() {
    this.TIMER_TICK_DURATION_MS = 1000;
    this.MAGNITUDE_BASE = 1000;

    this.DEMO_MODE = {
      EXAMPLE_1: 1, // plot 1 sensor (1 channel)
      EXAMPLE_2: 2, // plot 2 sensors ( 1 channel + 2 channels)
      EXAMPLE_3: 3, // plot 2 sensors ( 1 channel + 2 channels), sensor 1 miss data every 5 ticks
    };

    this.demoType = this.DEMO_MODE.EXAMPLE_5;
    this.timerId = null;
    this.isRunning = false;
    this.onDataGenerated = null;
    this.counter = 0;
    this.msOfMinuteFW = 0;

    // Cấu trúc config dạng array
    this.sensorConfigs = {
      1: {
        dataType: 0x01,
        sampleSize: 2,
        samplingRate: 50,
        isFirstTime: true,
        msOfMinuteFW: 200,
        configInfo: null,
        frameInfo: null,
        channels: 1,
        magnitudeOffset: 0,
      },
      2: {
        dataType: 0x02,
        sampleSize: 2,
        samplingRate: 5000,
        isFirstTime: true,
        msOfMinuteFW: 0,
        configInfo: null,
        frameInfo: null,
        channels: 1,
        magnitudeOffset: 500,
      },
    };

    // Khởi tạo dữ liệu cho từng config
    this.initSensorConfigs();
  }

  initSensorConfigs() {
    Object.keys(this.sensorConfigs).forEach((key) => {
      const config = this.sensorConfigs[key];
      config.configInfo = this.generateFrameConfig(config.channels, config);
      config.frameInfo = this.generateFrameInfo(config.channels, config);
    });
  }

  setupDemoType(value) {
    this.demoType = value;
  }

  start() {
    this.counter = 0;
    this.isRunning = true;
    if (this.timerId) return;
    this.timerId = setInterval(() => this.tick(), this.TIMER_TICK_DURATION_MS);
  }

  stop() {
    this.isRunning = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }
  pause() {
    this.isRunning = false;
  }

  reset() {
    this.msOfMinuteFW = 0;
  }

  tick() {
    this.msOfMinuteFW += 1000;
    if (this.msOfMinuteFW >= 60000) {
      this.msOfMinuteFW -= 60000;
    }
    if (!this.isRunning) return;
    const demoType = this.demoType;
    switch (demoType) {
      case this.DEMO_MODE.EXAMPLE_1:
        this.handleExample1(1);
        break;
      case this.DEMO_MODE.EXAMPLE_2:
        this.handleExample2();
        break;
      case this.DEMO_MODE.EXAMPLE_3:
        this.handleExample3();
        break;
    }
    console.log(`[DATA_SIM] msOfMinuteFW: ${this.msOfMinuteFW}`);
  }

  async handleSingleSensor(sensorId, counter = 0) {
    const config = this.sensorConfigs[sensorId];
    if (!config) return;

    if (config.isFirstTime) {
      this.onDataGenerated(config.configInfo);
      config.isFirstTime = false;
    } else {
      // Chỉ cập nhật timestamp trong frameInfo
      await this.updateTimestampInFrame(config);

      // Giả lập việc bỏ qua dữ liệu cho sensorId
      if (counter > 0 && counter % 3 === 0) {
        return;
      }
      this.onDataGenerated(config.frameInfo);
    }
  }

  async handleExample1() {
    // if (this.counter>=6){return;}
    await this.handleSingleSensor(1, this.counter);
    this.counter++;
    // await this.handleSingleSensor(1);
  }

  async handleExample2() {
    const COUNTER_THRESHOLD = 2;

    if (this.counter < COUNTER_THRESHOLD) {
      await this.handleSingleSensor(2);
    } else {
      await this.handleSingleSensor(1);
      await this.handleSingleSensor(2);
    }
    this.counter++;
  }
  async handleExample3() {
    const COUNTER_THRESHOLD = 3;

    if (this.counter < COUNTER_THRESHOLD) {
      await this.handleSingleSensor(2);
    } else {
      await this.handleSingleSensor(1, this.counter);
      await this.handleSingleSensor(2);
      // await this.handleSingleSensor(1);
      // await this.handleSingleSensor(2, this.counter);
    }
    this.counter++;
  }

  // Cập nhật timestamp trong frameInfo mà không tạo lại dữ liệu
  async updateTimestampInFrame(config) {
    // Cập nhật trực tiếp vào payload của frameInfo (vị trí byte 1 và 2)
    if (config.frameInfo && config.frameInfo.data) {
      let msOfMinuteFW = this.msOfMinuteFW + config.msOfMinuteFW;
      if (msOfMinuteFW >= 60000) {
        msOfMinuteFW -= 60000;
      }
      // Byte 1: timestamp low byte
      config.frameInfo.data[1] = msOfMinuteFW & 0xff;
      // Byte 2: timestamp high byte
      config.frameInfo.data[2] = (msOfMinuteFW >> 8) & 0xff;
    }
  }

  generateFrameConfig(channels, config) {
    const payload = new Uint8Array(5);
    let offset = 0;

    payload[offset++] = config.dataType;
    payload[offset++] = channels;
    payload[offset++] = config.samplingRate & 0xff;
    payload[offset++] = (config.samplingRate >> 8) & 0xff;
    payload[offset++] = config.sampleSize;

    return {
      cmd: 0x93,
      data: payload,
      data_len: payload.length,
      crcOk: true,
    };
  }

  generateFrameInfo(channels, config) {
    const sinData = [];

    // Tạo dữ liệu sin cho từng channel (chỉ tạo 1 lần)
    for (let i = 0; i < channels; i++) {
      const magnitude = this.MAGNITUDE_BASE + i * 500 + config.magnitudeOffset;
      sinData.push(this.generateSinData(config.samplingRate, magnitude));
    }

    const totalSamples = sinData[0].length;
    const payload = new Uint8Array(3 + totalSamples * channels * 2);
    let offset = 0;

    // Header: dataType + timestamp (sẽ được cập nhật sau)
    payload[offset++] = config.dataType;
    payload[offset++] = config.msOfMinuteFW & 0xff; // timestamp low byte
    payload[offset++] = (config.msOfMinuteFW >> 8) & 0xff; // timestamp high byte

    // Dữ liệu các channel (cố định, không thay đổi)
    for (let k = 0; k < totalSamples; k++) {
      for (let ch = 0; ch < channels; ch++) {
        const value = sinData[ch][k];
        payload[offset++] = value & 0xff;
        payload[offset++] = (value >> 8) & 0xff;
      }
    }

    return {
      cmd: 0x92,
      data: payload,
      data_len: payload.length,
      crcOk: true,
    };
  }

  // Các phương thức cũ để tương thích ngược
  generateConfigPacket1Channel() {
    return this.generateFrameConfig(1, this.sensorConfigs[1]);
  }

  generateDataPacket1Channel() {
    return this.generateFrameInfo(1, this.sensorConfigs[1]);
  }

  generateConfigPacket2Channel() {
    return this.generateFrameConfig(2, this.sensorConfigs[2]);
  }

  generateDataPacket2Channel() {
    return this.generateFrameInfo(2, this.sensorConfigs[2]);
  }

  generateSinData(numSamples = 10, magnitude = 100) {
    const data = new Int16Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      const angle = (2 * Math.PI * i) / numSamples;
      data[i] = Math.round(magnitude * Math.sin(angle));
    }
    return data;
  }

  addSensorConfig(id, config) {
    this.sensorConfigs[id] = {
      dataType: config.dataType || 0x01,
      sampleSize: config.sampleSize || 2,
      samplingRate: config.samplingRate || 1000,
      isFirstTime: true,
      msOfMinuteFW: 0,
      configInfo: null,
      frameInfo: null,
      channels: config.channels || 1,
      magnitudeOffset: config.magnitudeOffset || 0,
      ...config,
    };

    const newConfig = this.sensorConfigs[id];
    newConfig.configInfo = this.generateFrameConfig(newConfig.channels, newConfig);
    newConfig.frameInfo = this.generateFrameInfo(newConfig.channels, newConfig);
  }
}

export const DATA_SIM = new DataSimulation();
