// --- LOG FILE MANAGER ---
import { CONSTANTS } from "./constants.js";
class FileLogManager {
  constructor(options = {}) {
    // Cấu hình
    this.interval = options.interval || 1000; // Mặc định 1 giây
    this.buffer = [];
    this.fileNameMapping = {};
    this.fileHandlers = {};
    this.timer = null;
    this.dirHandle = null;
    this.isWriting = false;
    this.maxBufferSize = options.maxBufferSize || 1000;
    this.isLoggingActive = false; // Thêm flag để kiểm soát logging
    this.sessionId = null; // Thêm session ID để tạo file mới

    this.channelMapping = {}; // Mapping originalChannel -> R1, R2, E1, E2,...

    this.lastIndex = {};
    this.lastMsOfMinuteFW = {};
    /**
     *  Callback to update the notification message UI
     * @param {string} text - content to display in notification area
     */
    this.onMessageNotify = () => {}; //

    // Stats
    this.stats = {
      totalWrites: 0,
      totalErrors: 0,
      lastWriteTime: null,
      totalDataPoints: 0,
    };
  }

  async isDirectFileWriteAvailable() {
    return !!window.showSaveFilePicker;
  }

  // ==================== KHỞI TẠO ====================

  async initializeDirectory() {
    try {
      if (this.dirHandle) {
        return this.dirHandle;
      }

      this.dirHandle = await window.showDirectoryPicker({
        mode: "readwrite",
      });

      this.onMessageNotify("success", `✅ User selected a directory to save the log files: ${this.dirHandle.name}`);
      return true;
    } catch (error) {
      this.onMessageNotify("error", "Error initializing directory");
      return false;
    }
  }

  async resetDirectory() {
    this.dirHandle = null;
  }

  // ==================== QUẢN LÝ SESSION ====================

  /**
   * Bắt đầu một session logging mới
   * Tạo session ID mới và reset mapping để tạo file mới
   */
  async initNewSession() {
    // Generate a new session ID based on the current timestamp.
    this.sessionId = Math.floor(new Date() / 1000); // Unix timestamp in seconds
    this.isLoggingActive = true;

    // Reset mappings and file handlers to create new log files.
    this.fileNameMapping = {};
    this.fileHandlers = {};
    this.buffer.forEach((sensor) => {
      sensor.dataPoints = [];
    });
    this.onMessageNotify("success", `✅ Started a new logging session. Session ID: ${this.sessionId}`);
    return this.sessionId;
  }

  // ==================== QUẢN LÝ SENSOR ====================

  /**
   * Adds a batch of samples to the chart buffer for a specific channel.
   */
  async addFileLogBuffer(sensorData, samplingRate, sensorName, msOfMinuteFW) {
    // Kiểm tra nếu logging không active thì không thêm dữ liệu
    if (!this.isLoggingActive) {
      return;
    }

    if (sensorData.length === 0) return;

    const channel_count = sensorData.length;
    const sampleCountInBatch = sensorData[0].length;

    let isDataMissing = false;
    let missingSampleCount = 0;

    if (!this.lastIndex[sensorName]) {
      this.lastIndex[sensorName] = 1; // Start index from 1
      isDataMissing = false;
    } else {
      let diffMsOfMinuteFW = msOfMinuteFW - this.lastMsOfMinuteFW[sensorName];
      if (diffMsOfMinuteFW < 0) {
        diffMsOfMinuteFW = msOfMinuteFW + 60000 - this.lastMsOfMinuteFW[sensorName];
      }
      const SAMPLE_INTERVAL_MS = 1000 / samplingRate;
      const estimatedSampleCount = Math.floor(diffMsOfMinuteFW / SAMPLE_INTERVAL_MS);
      const ratio = estimatedSampleCount / sampleCountInBatch;
      if (ratio > 1.5) {
        isDataMissing = true;
        missingSampleCount = (Math.floor(ratio) - 1) * sampleCountInBatch;
      }
    }
    this.lastMsOfMinuteFW[sensorName] = msOfMinuteFW;
    let currentIndex = this.lastIndex[sensorName] + missingSampleCount;

    const dataPoints = [];
    for (let k = 0; k < sampleCountInBatch; k++) {
      let sample = [currentIndex]; // sample index
      for (let i = 0; i < channel_count; i++) {
        sample.push(sensorData[i][k]); // sample value of each channel
      }
      dataPoints.push({ sample });
      currentIndex++;
    }
    this.lastIndex[sensorName] = currentIndex;

    if (dataPoints.length === 0) return;

    const idx = this.buffer.findIndex((item) => item.name === sensorName);
    if (idx >= 0) {
      this.buffer[idx].dataPoints.push(...dataPoints);
    } else {
      this.buffer.push({ name: sensorName, samplingRate: samplingRate, dataPoints });
    }
  }

  // ==================== MAPPING SENSOR ====================
  getFileName(data_type_id_str, samplingRate) {
    if (!this.fileNameMapping[data_type_id_str]) {
      const date = new Date(this.sessionId * 1000);
      const pad = (n) => String(n).padStart(2, "0");
      const dateStr =
        `${date.getFullYear()}` +
        `${pad(date.getMonth() + 1)}` +
        `${pad(date.getDate())}_` +
        `${pad(date.getHours())}` +
        `${pad(date.getMinutes())}` +
        `${pad(date.getSeconds())}`;

      // Thêm session ID vào tên file để phân biệt các session
      const sessionPrefix = this.sessionId ? `session_${this.sessionId}_${dateStr}` : "";

      const nameLoggingFile = CONSTANTS.STREAM_TYPES[data_type_id_str].nameLoggingFile ?? CONSTANTS.DEFAULT_SENSOR_NAME;
      const fileName = `${sessionPrefix}_${nameLoggingFile}_${samplingRate}Hz.txt`;
      this.fileNameMapping[data_type_id_str] = fileName;
      // console.log(`Mapped sensor: ${data_type_id_str} -> ${fileName}`);
    }
    return this.fileNameMapping[data_type_id_str];
  }

  async getOrCreateFileHandler(data_type_id_str, samplingRate) {
    const fileName = this.getFileName(data_type_id_str, samplingRate);

    if (!this.fileHandlers[fileName]) {
      try {
        if (!this.dirHandle) {
          await this.initializeDirectory();
        }

        // Kiểm tra file đã tồn tại chưa
        let fileHandle;
        try {
          // Thử lấy file đã tồn tại
          fileHandle = await this.dirHandle.getFileHandle(fileName);
        } catch (error) {
          // File không tồn tại, tạo mới
          fileHandle = await this.dirHandle.getFileHandle(fileName, {
            create: true,
          });
          this.onMessageNotify("success", `Writing to file: ${fileName}`);
        }
        this.fileHandlers[fileName] = fileHandle;
      } catch (error) {
        this.onMessageNotify("error", `Error creating file handler for ${fileName}`);
        throw error;
      }
    }

    return this.fileHandlers[fileName];
  }

  // ==================== GHI DỮ LIỆU ====================
  async writeDataToFile(fileHandle, sensor) {
    if (!sensor.dataPoints || sensor.dataPoints.length === 0) return 0;

    try {
      const file = await fileHandle.getFile();
      const existingText = await file.text();
      const isEmptyFile = existingText.length === 0;

      const writable = await fileHandle.createWritable({
        keepExistingData: true,
      });

      // append đúng vị trí
      if (!isEmptyFile) {
        await writable.seek(file.size);
      }

      // ===== HEADER =====
      if (isEmptyFile) {
        const dataType = sensor.name; // Assuming sensor.name is like "data_type_0"
        const firstPoint = sensor.dataPoints[0].sample;
        const prefix = CONSTANTS.STREAM_TYPES[dataType].nameChartLabel ?? CONSTANTS.DEFAULT_SENSOR_NAME;
        const header1 =
          `timestamp,` + Array.from({ length: firstPoint.length - 1 }, (_, i) => `${prefix}${i + 1}`).join(",") + "\n";
        const header =
          `index,` + Array.from({ length: firstPoint.length - 1 }, (_, i) => `${prefix}${i + 1}`).join(",") + "\n";

        await writable.write(header);
      }

      // ===== DATA =====
      const dataToWrite = sensor.dataPoints
        .map((s) => {
          const point = s.sample;
          if (!Array.isArray(point) || point.length < 2) return null;
          const dateObj = point[0] instanceof Date ? point[0] : new Date(point[0]);
          if (isNaN(dateObj.getTime())) return null;
          const timestamp = dateObj.toISOString().replace("Z", "");
          const [index, ...restValues] = point;
          const values = restValues.join(",");
          return `${index},${values}\n`;
        })
        .filter(Boolean)
        .join("");

      await writable.write(dataToWrite);
      await writable.close();

      sensor.dataPoints = [];
    } catch (err) {
      this.onMessageNotify("error", `writeDataToFile error: ${err}`);
    }
  }

  // ==================== AUTO WRITE ====================

  async start() {
    // An active logging session already exists, do not start a new one.
    if (this.isLoggingActive) return;

    // Bắt đầu session mới
    await this.initNewSession();

    // Start timer to write file
    this.autoWriteFile();
  }
  async autoWriteFile() {
    if (this.timer !== null) {
      return;
    }
    // console.log("Starting auto-write...");

    this.timer = setInterval(async () => {
      // Kiểm tra buffer có dữ liệu không và logging đang active
      const hasData = this.buffer.some((s) => s.dataPoints && s.dataPoints.length > 0);
      if (!hasData || !this.isLoggingActive) {
        return;
      }

      if (this.isWriting) {
        console.warn("Previous write still in progress, skipping...");
        return;
      }

      this.isWriting = true;

      try {
        if (!this.dirHandle) {
          await this.initializeDirectory();
        }

        for (const sensor of this.buffer) {
          if (!sensor.dataPoints || sensor.dataPoints.length === 0) {
            continue;
          }

          try {
            const fileHandle = await this.getOrCreateFileHandler(sensor.name, sensor.samplingRate);
            await this.writeDataToFile(fileHandle, sensor);
          } catch (error) {
            console.error(`Failed to write sensor ${sensor.name}:`, error);
            this.stats.totalErrors++;
          }
        }
      } catch (error) {
        console.error("Error in auto-write cycle:", error);
        this.stats.totalErrors++;
      } finally {
        this.isWriting = false;
      }
      if (!this.isLoggingActive) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }, this.interval);
  }

  // ==================== DỪNG AUTO WRITE ====================

  finish() {
    this.isLoggingActive = false; // Set this flag to stop the timer in autoWriteFile()
    this.onMessageNotify(
      "success",
      `✅ Logging session finished. Session ID: ${this.sessionId}, Files saved to folder: ${this.dirHandle.name}`,
    );
  }
}

export const FILE_LOG_MANAGER = new FileLogManager();
