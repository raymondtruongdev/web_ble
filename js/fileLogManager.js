// --- LOG FILE MANAGER ---
class FileLogManager {
  constructor(options = {}) {
    // Cấu hình
    this.interval = options.interval || 1000; // Mặc định 1 giây
    this.buffer = [];
    this.sensorNameMapping = {};
    this.fileHandlers = {};
    this.timer = null;
    this.dirHandle = null;
    this.isWriting = false;
    this.maxBufferSize = options.maxBufferSize || 1000;
    this.isLoggingActive = false; // Thêm flag để kiểm soát logging
    this.sessionId = null; // Thêm session ID để tạo file mới

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

      console.log("Directory initialized successfully");
      return this.dirHandle;
    } catch (error) {
      console.error("Error initializing directory:", error);
      throw new Error("Failed to initialize directory: " + error.message);
    }
  }

  // ==================== QUẢN LÝ SESSION ====================

  /**
   * Bắt đầu một session logging mới
   * Tạo session ID mới và reset mapping để tạo file mới
   */
  startNewSession() {
    // Tạo session ID mới dựa trên timestamp
    this.sessionId = new Date().getTime();
    this.isLoggingActive = true;

    // Reset mapping và file handlers để tạo file mới
    this.reset();

    console.log(`New logging session started: ${this.sessionId}`);
    return this.sessionId;
  }

  // ==================== QUẢN LÝ SENSOR ====================

  /**
   * Adds a batch of samples to the chart buffer for a specific channel.
   */
  async addFileLogBuffer(sensorData, sampleIntervalSec, baseTimestamp, sensorName = "ch1") {
    // Kiểm tra nếu logging không active thì không thêm dữ liệu
    if (!this.isLoggingActive) {
      console.warn("Logging is not active, ignoring data");
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

  getMappedName(originalSensorName) {
    if (!this.sensorNameMapping[originalSensorName]) {
      // Thêm session ID vào tên file để phân biệt các session
      const sessionPrefix = this.sessionId ? `session_${this.sessionId}_` : "";
      const mappedName = `${sessionPrefix}data_${originalSensorName}.txt`; // set filename to save
      this.sensorNameMapping[originalSensorName] = mappedName;
      console.log(`Mapped sensor: ${originalSensorName} -> ${mappedName}`);
    }
    return this.sensorNameMapping[originalSensorName];
  }

  async getOrCreateFileHandler(originalSensorName) {
    const mappedName = this.getMappedName(originalSensorName);

    if (!this.fileHandlers[mappedName]) {
      try {
        if (!this.dirHandle) {
          await this.initializeDirectory();
        }

        // Kiểm tra file đã tồn tại chưa
        let fileHandle;
        try {
          // Thử lấy file đã tồn tại
          fileHandle = await this.dirHandle.getFileHandle(mappedName);
          console.log(`File already exists: ${mappedName}`);
        } catch (error) {
          // File không tồn tại, tạo mới
          fileHandle = await this.dirHandle.getFileHandle(mappedName, {
            create: true,
          });
          console.log(`Created new file: ${mappedName}`);
        }

        this.fileHandlers[mappedName] = fileHandle;
        console.log(`File handler ready for: ${mappedName}`);
      } catch (error) {
        console.error(`Error creating file handler for ${mappedName}:`, error);
        throw error;
      }
    }

    return this.fileHandlers[mappedName];
  }

  // ==================== GHI DỮ LIỆU ====================

  async writeDataToFile(fileHandle, sensor) {
    if (!sensor.dataPoints || sensor.dataPoints.length === 0) {
      return;
    }

    try {
      // Kiểm tra kích thước file để quyết định có thêm header không
      let fileSize = 0;
      try {
        const file = await fileHandle.getFile();
        fileSize = file.size;
      } catch (error) {
        // Nếu không lấy được kích thước, coi như file trống
        fileSize = 0;
      }

      // Tạo writable stream
      const writable = await fileHandle.createWritable({
        keepExistingData: true,
      });

      // Format dữ liệu
      const dataToWrite = sensor.dataPoints
        .map((s) => {
          const point = s.sample;
          if (!Array.isArray(point) || point.length < 2) {
            return null;
          }

          let dateObj = point[0] instanceof Date ? point[0] : new Date(point[0]);
          const timestamp = dateObj.toISOString().replace("Z", "");
          const values = point.slice(1).join(",");

          return `${timestamp},${values}\n`;
        })
        .filter((line) => line !== null)
        .join("");

      // Nếu file trống, thêm header
      if (fileSize === 0 && sensor.dataPoints.length > 0) {
        const firstPoint = sensor.dataPoints[0].sample;
        const header = `timestamp,${Array.from({ length: firstPoint.length - 1 }, (_, i) => `value_${i + 1}`).join(",")}\n`;
        await writable.write(header);
      }

      // Ghi dữ liệu
      await writable.write(dataToWrite);
      await writable.close();

      // Cập nhật stats
      this.stats.totalWrites++;
      this.stats.lastWriteTime = new Date();

      // Clear buffer sau khi ghi thành công
      const writtenCount = sensor.dataPoints.length;
      sensor.dataPoints = [];

      console.log(`Written ${writtenCount} data points for sensor ${sensor.name}`);
      return writtenCount;
    } catch (error) {
      console.error(`Error writing to file for sensor ${sensor.name}:`, error);
      this.stats.totalErrors++;
      throw error;
    }
  }

  // ==================== AUTO WRITE ====================

  async autoWriteBuffer() {
    if (this.timer !== null) {
      console.warn("Auto-write is already running");
      return;
    }

    if (this.isWriting) {
      console.warn("Write operation in progress");
      return;
    }

    // Bắt đầu session mới
    this.startNewSession();

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
    }, this.interval);
  }

  // ==================== DỪNG AUTO WRITE ====================

  stopAutoWrite() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;

      // Kết thúc session
      this.isLoggingActive = false;
      console.log(`Logging session ended: ${this.sessionId}`);
      this.sessionId = null;

      console.log("Auto-write stopped");
      return true;
    }
    console.warn("Auto-write is not running");
    return false;
  }



  // ==================== RESET & CLEANUP ====================

  reset() {
    // Reset mapping
    this.sensorNameMapping = {};
    this.fileHandlers = {};
    console.log("Mapping reset");
    // Clear buffer
    this.buffer.forEach((sensor) => {
      sensor.dataPoints = [];
    });
    console.log("Buffer cleared");
  }
}

export const FILE_LOG_MANAGER = new FileLogManager();
