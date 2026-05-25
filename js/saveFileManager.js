// --- SAVE FILE MANAGER ---
export class SaveFileManager {
  constructor() {
    this.bootTime = Date.now() - performance.now();
    this.fileHandle = null;
    this.writable = null;
    this.isStreaming = false;
    this.recordedCount = 0;
    this.firstTimestamp = null; // performance.now()
    this.capacity = 60000; // buffer is 60000 points
    this.values = new Float32Array(this.capacity);
    this.times = new Float64Array(this.capacity);

    /**
     * Callback to notify a message (e.g., for showing in terminal).
     * @param {string} type - Type of the message (e.g., "info", "warning", "error")
     * @param {string} text - Message text to display
     */
    this.onMessageNotify = () => {};
  }

  async check_allow_direct_stream_support() {
    const supportsFilePicker = "showOpenFilePicker" in window && "showSaveFilePicker" in window;
    return supportsFilePicker;
  }

  async start(suggestedName) {
    this.isStreaming = false;
    this.recordedCount = 0;
    this.firstTimestamp = null;
    if ("showSaveFilePicker" in window) {
      try {
        this.fileHandle = await window.showSaveFilePicker({
          suggestedName,
          types: [{ description: "Tệp Văn Bản (.txt)", accept: { "text/plain": [".txt"] } }],
        });
        this.isStreaming = true;
        return "WRITE_FILE_DIRECTLY"; // ghi trực tiếp vào file trong lúc stream
      } catch (e) {
        if (e.name === "AbortError") throw e;
        return  "WRITE_BUFFER"; // ghi tạm vào bộ nhớ, cuối cùng mới xuất file
      }
    }
    return "WRITE_BUFFER";
  }

  async write(val, timestamp) {
    if (this.firstTimestamp === null) this.firstTimestamp = timestamp;

    // Luôn lưu vào mảng để tính toán header khi kết thúc
    if (this.recordedCount >= this.capacity) {
      const newCap = this.capacity * 2;
      const nv = new Float32Array(newCap),
        nt = new Float64Array(newCap);
      nv.set(this.values);
      nt.set(this.times);
      this.values = nv;
      this.times = nt;
      this.capacity = newCap;
    }
    this.values[this.recordedCount] = val;
    this.times[this.recordedCount] = timestamp;
    this.recordedCount++;
  }

  async finish() {
    if (this.isStreaming && this.fileHandle) {
      try {
        this.writable = await this.fileHandle.createWritable();
        const content = this._generateFileContent();
        await this.writable.write(content);
        await this.writable.close();
        this.onMessageNotify("success", "Data saved at: " + this.fileHandle.name);
      } catch (e) {
        console.error("Lỗi ghi file trực tiếp:", e);
      } finally {
        this.writable = null;
      }
    } else {
      if (this.recordedCount === 0) {
        this.onMessageNotify("warning", "No data available to save.");
        return;
      }
      if (this.fileHandle) {
        // If a file handle was acquired, the file will be saved on stop.
        this.onMessageNotify("success", "Data is being recorded directly to disk.");
      } else if (this.recordedCount > 0) {
        this.downloadFallback();
        this.onMessageNotify("success", "Fallback data file generated.");
      } else {
        this.onMessageNotify("warning", "No data available to save.");
      }
    }
  }

  _generateFileContent() {
    if (this.recordedCount === 0) return "";

    const firstPerf = this.times[0];
    const lastPerf = this.times[this.recordedCount - 1];

    // Tính toán timestamps
    const startEpoch = Math.floor((this.bootTime + firstPerf) / 1000);
    const endEpoch = Math.floor((this.bootTime + lastPerf) / 1000);
    const duration = ((lastPerf - firstPerf) / 1000).toFixed(2);

    // Format thời gian xuất file: HH:mm:ss DD/M/YYYY
    const now = new Date();
    const timePart = now.toTimeString().split(" ")[0];
    const datePart = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;
    const exportTime = `${timePart} ${datePart}`;

    let txt = `=== DỮ LIỆU ĐO PPG  ===\n`;
    txt += `Start timestamp : ${startEpoch}\n`;
    txt += `End timestamp\t: ${endEpoch}\n`;
    txt += `Duration        : ${duration} seconds\n`;
    txt += `Total samples   : ${this.recordedCount}\n`;
    txt += `Time export file: ${exportTime}\n`;
    txt += `----------------------------------------\n`;
    txt += `Thời gian (s), Giá trị PPG (ADC)\n`;

    for (let i = 0; i < this.recordedCount; i++) {
      const relTime = ((this.times[i] - firstPerf) / 1000).toFixed(3);
      txt += `${relTime}, ${this.values[i].toFixed(2)}\n`;
    }
    return txt;
  }

  downloadFallback() {
    const txt = this._generateFileContent();
    const blob = new Blob([txt], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ppg_data_${new Date().getTime()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  reset() {
    this.stop();
    this.fileHandle = null;
    this.isStreaming = false;
    this.recordedCount = 0;
    this.firstTimestamp = null;
  }
}
