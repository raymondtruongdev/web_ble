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

      this.onMessageNotify("success", `Logging folder selected by user: ${this.dirHandle.name}`);
      return true;
    } catch (error) {
      console.error("Error initializing directory:", error);
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
    this.sessionId = Date.now();
    this.isLoggingActive = true;

    // Reset mappings and file handlers to create new log files.
    this.fileNameMapping = {};
    this.fileHandlers = {};
    this.buffer.forEach((sensor) => {
      sensor.dataPoints = [];
    });
    this.onMessageNotify("success", `New logging session started: ${this.sessionId}`);

    return this.sessionId;
  }

  // ==================== QUẢN LÝ SENSOR ====================

  /**
   * Adds a batch of samples to the chart buffer for a specific channel.
   */
  async addFileLogBuffer(sensorData, sampleIntervalSec, baseTimestamp, sensorName = "data_type_0") {
    // Kiểm tra nếu logging không active thì không thêm dữ liệu
    if (!this.isLoggingActive) {
      return;
    }

    if (sensorData.length === 0) return;

    const dataPoints = [];
    const no_sensor = sensorData.length;
    const n_sample = sensorData[0].length;

    for (let k = 0; k < n_sample; k++) {
      let sample = [baseTimestamp + k * sampleIntervalSec];
      for (let i = 0; i < no_sensor; i++) {
        sample.push(sensorData[i][k]);
      }
      dataPoints.push({ sample });
    }

    if (dataPoints.length === 0) return;

    const idx = this.buffer.findIndex((item) => item.name === sensorName);
    if (idx >= 0) {
      this.buffer[idx].dataPoints.push(...dataPoints);
    } else {
      this.buffer.push({ name: sensorName, dataPoints });
    }
  }

  // ==================== MAPPING SENSOR ====================
  getMappedName(originalSensorName, mappingTable = CONSTANTS.DATATYPE_CHANNEL_NAME_MAPPING) {
    let mappedSensorName = originalSensorName;
    const match = originalSensorName.match(/^(data_type_\d+)/);
    if (match) {
      const dataType = match[1];
      mappedSensorName = mappingTable[dataType] ?? CONSTANTS.DEFAULT_SENSOR_NAME;
    }
    return mappedSensorName;
  }

  getFileName(originalSensorName) {
    if (!this.fileNameMapping[originalSensorName]) {
      // Thêm session ID vào tên file để phân biệt các session
      const sessionPrefix = this.sessionId ? `session_${this.sessionId}` : "";
      const mappedSensorName = this.getMappedName(originalSensorName, CONSTANTS.DATATYPE_FILENAME_MAPPING);

      const fileName = `${sessionPrefix}_${mappedSensorName}.txt`;

      this.fileNameMapping[originalSensorName] = fileName;
      console.log(`Mapped sensor: ${originalSensorName} -> ${fileName}`);
    }
    return this.fileNameMapping[originalSensorName];
  }

  async getOrCreateFileHandler(originalSensorName) {
    const fileName = this.getFileName(originalSensorName);

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
          console.log(`File already exists: ${fileName}`);
        } catch (error) {
          // File không tồn tại, tạo mới
          fileHandle = await this.dirHandle.getFileHandle(fileName, {
            create: true,
          });
          console.log(`Created new file: ${fileName}`);
        }

        this.fileHandlers[fileName] = fileHandle;
        console.log(`File handler ready for: ${fileName}`);
      } catch (error) {
        console.error(`Error creating file handler for ${fileName}:`, error);
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
        const firstPoint = sensor.dataPoints[0].sample;

        const mappedSensorName = this.getMappedName(sensor.name, CONSTANTS.DATATYPE_CHANNEL_NAME_MAPPING);

        const header =
          `timestamp,` +
          Array.from({ length: firstPoint.length - 1 }, (_, i) => `${mappedSensorName}${i + 1}`).join(",") +
          "\n";

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
          const values = point.slice(1).join(",");
          return `${timestamp},${values}\n`;
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
    console.log("Starting auto-write...");

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
            const fileHandle = await this.getOrCreateFileHandler(sensor.name);
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
      `Logging session finished: ${this.sessionId}, Files saved to folder: ${this.dirHandle.name}`,
    );
  }
}

export const FILE_LOG_MANAGER = new FileLogManager();
