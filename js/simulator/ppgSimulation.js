// ============================================================
// PPGSimulation – sinh dữ liệu PPG, phát event ra ngoài
// ============================================================
class PPGSimulation {
  constructor(sampleRate = 500) {
    this.sampleRate = sampleRate;
    this.sampleIntervalMs = 1000 / sampleRate;
    this.isRunning = false;
    this.wavePhase = 0;
    this.lastDataGenTime = null;
    this.lastSystolicFlash = 0; // Thời điểm nhịp đập cuối cùng
    this.onHeartBeat = null;
    this.onDataGenerated = null;
    this.timerId = null;
    this.currentBpm = 50; // Mặc định 50 BPM
  }

  generatePPGSample(phase) {
    let signal = 0;
    if (phase < 0.25) signal = Math.sin(((phase / 0.25) * Math.PI) / 2);
    else if (phase < 0.38) signal = 1.0 - 0.35 * Math.sin((((phase - 0.25) / 0.13) * Math.PI) / 2);
    else if (phase < 0.45) signal = 0.65 - 0.05 * Math.sin((((phase - 0.38) / 0.07) * Math.PI) / 2);
    else if (phase < 0.6) signal = 0.6 + 0.12 * Math.sin((((phase - 0.45) / 0.15) * Math.PI) / 2);
    else signal = 0.72 * Math.cos((((phase - 0.6) / 0.4) * Math.PI) / 2);
    const noise = (Math.random() - 0.5) * 1.5;
    return Math.max(0, Math.min(1000, (signal * 65 + 15 + noise) * 10));
  }

  startPPG() {
    if (this.timerId) return;
    this.isRunning = true;
    // Chạy mỗi 20ms để dữ liệu đổ về mượt mà hơn (50 lần mỗi giây)
    this.timerId = setInterval(() => this.tick(), 20);
  }

  stopPPG() {
    this.isRunning = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  tick() {
    if (!this.isRunning) return;
    const now = performance.now();
    if (this.lastDataGenTime === null) {
      this.lastDataGenTime = now;
      return;
    }
    const elapsed = now - this.lastDataGenTime;
    const samplesNeeded = Math.floor(elapsed / this.sampleIntervalMs);
    if (samplesNeeded > 0) {
      const bpm = 30 + (this.currentBpm - 1) * (150 / 99);
      const phaseStep = (bpm / 60) / this.sampleRate;
      const generatedSamples = []; // Mảng để lưu trữ các mẫu trong batch này
      for (let i = 0; i < samplesNeeded; i++) {
        this.wavePhase = (this.wavePhase + phaseStep) % 1.0;
        if (this.wavePhase > 0.2 && this.wavePhase < 0.25 && now - this.lastSystolicFlash > (60000 / bpm) * 0.7) {
          if (this.onHeartBeat) this.onHeartBeat();
          this.lastSystolicFlash = now;
        }
        const value = this.generatePPGSample(this.wavePhase);
        const timestamp = this.lastDataGenTime + (i + 1) * this.sampleIntervalMs; // Timestamp của mẫu hiện tại
        generatedSamples.push({ value, timestamp });
      }
      if (this.onDataGenerated && generatedSamples.length > 0) this.onDataGenerated(generatedSamples); // Kích hoạt một lần với toàn bộ batch
      this.lastDataGenTime += samplesNeeded * this.sampleIntervalMs;
    }
  }

  reset() {
    this.stopPPG();
    this.lastDataGenTime = null;
    this.wavePhase = 0;
  }
}

// Export một instance duy nhất (Singleton Pattern)
/** @type {PPGSimulation} */
export const PPG = new PPGSimulation();
