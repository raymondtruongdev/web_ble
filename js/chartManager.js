// ============================================================
// ChartManager – vẽ đồ thị PPG lên Canvas, quản lý hover & pan
// - Click trái + kéo: Zoom trên trục X/Y
// - Click phải + kéo ngang: Pan theo trục X
// - Click phải + kéo dọc: Pan theo trục Y
// - Click vào label: Toggle hiển thị đường tương ứng
// ============================================================
import { CONSTANTS } from "./constants.js";

const Utils = {
  formatIndex(index) {
    return Math.round(index).toString();
  },
  formatIndexWithDecimal(index) {
    return index.toFixed(1);
  },
};

class ChartManager {
  constructor() {
    // === CẤU HÌNH TRỤC THỜI GIAN ===
    // BASE_TIME_UNIT: đơn vị thời gian cơ bản của trục X (10000 = 1Hz)
    // Mọi channel sẽ được ánh xạ về đơn vị này để vẽ chung trên cùng trục X
    this.BASE_TIME_UNIT = 10000; // 10000 units = 1 giây

    // VIEW_DURATION: khoảng thời gian hiển thị trên chart (10 giây)
    this.VIEW_DURATION = this.BASE_TIME_UNIT * 10;

    // MAX_DATA_KEEP: thời gian dữ liệu tối đa được giữ trong bộ nhớ (30 giây)
    this.MAX_DATA_KEEP = this.BASE_TIME_UNIT * 30;

    // === CẤU HÌNH RENDER ===
    this.RENDER_INTERVAL_MS = 20; // 20ms = 50fps
    this.RENDER_STEP = (this.BASE_TIME_UNIT / 1000) * this.RENDER_INTERVAL_MS;

    // === GIỚI HẠN ZOOM ===
    this.MIN_VIEW_DURATION = this.BASE_TIME_UNIT / 100; // Tối thiểu 0.01s
    this.MAX_VIEW_DURATION = this.MAX_DATA_KEEP; // Tối đa 30s

    // === TRẠNG THÁI DỮ LIỆU ===
    this.buffer = []; // Buffer chứa dữ liệu thô từ các channel
    this.chartTimer = null;
    this.canvas = null;
    this.ctx = null;
    this.dataPoints = {}; // Dữ liệu đã xử lý theo channel: { channelName: [point, ...] }
    this.customLabels = [];
    this.channelMapping = {};
    this.nextChannelIndex = 1;
    this.margins = { left: 70, right: 20, top: 30, bottom: 40 };

    // === TRẠNG THÁI VIEW ===
    this.viewOffset = 0; // Độ lệch view so với thời gian hiện tại
    this.hoverPoint = null;
    this.mouseX = null;
    this.dragMode = null;
    this.startPanX = 0;
    this.startPanY = 0;
    this.originalViewOffset = 0;
    this.originalYMin = 0;
    this.originalYMax = 0;

    // === TRẠNG THÁI ĐIỀU KHIỂN ===
    this.isRunning = false;
    this.isPaused = false;
    this.drawPending = false;
    this.isAutoFit = true;
    this.frozenTime = null; // Thời gian bị đóng băng (dùng khi pause)
    this.hasReceivedFirstData = false;

    // === GIỚI HẠN TRỤC Y ===
    this.yMin = -2000;
    this.yMax = 2000;

    // === TRẠNG THÁI ZOOM ===
    this.zoomStartX = 0;
    this.zoomStartY = 0;
    this.zoomOriginalDuration = 0;
    this.zoomOriginalYMin = 0;
    this.zoomOriginalYMax = 0;
    this.zoomStartDataValue = 0;
    this.zoomStartMouseRatio = 0;

    // === SỰ KIỆN & TƯƠNG TÁC ===
    this.onAutoFitChange = () => {};
    this.isInteracting = false;
    this.legendButtons = [];
    this.mouseDownX = 0;
    this.mouseDownY = 0;
    this.isDragging = false;

    // === THÔNG TIN CHANNEL ===
    this.globalIndexStep = {}; // khoảng cách 2 sample liên tiếp của channel
    this.lastGlobalIndex = {}; // global index của sample cuối cùng của mỗi channel
    this.localIndex = {}; // local indexcủa sample trong mỗi channel
    this.lastGlobalIndexRender = 0; //  value Global index dùng để render chart (cập nhật theo thời gian thực)
    this.lastMsOfMinuteFW = {}; // milisecond of minute của sample bắt đầu trong batch data trước đó

    this.channelOrder = []; // Thứ tự hiển thị các channel
    this.channelColorMap = {}; // Màu sắc cho từng channel

    /**
     * Callback to notify a message from BLE manager
     * @param {string} type - Type of the message (e.g., "info", "warning", "error")
     * @param {string} text - Message text to display
     */
    this.onMessageNotify = () => {};
  }

  init(canvas) {
    if (!canvas) return;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.setupEvents();
    this.setAutoFit(true);
  }

  start() {
    this.isRunning = true;
    this.clear();
    this.unfreeze();
    this.setAutoFit(true);
    this.lastGlobalIndexRender = this.getCurrentGlobalIndex() || 0;
    this.autoRender();
  }

  stop() {
    this.isRunning = false;
    this.freezeCurrentView();
  }

  freezeCurrentView() {
    const currentTime = this.getCurrentGlobalIndex();
    this.isPaused = true;
    this.frozenTime = currentTime;
    this.requestRedraw();
  }

  unfreeze() {
    this.isPaused = false;
    this.frozenTime = null;
    this.viewOffset = 0;
    this.requestRedraw();
  }

  clear() {
    this.dataPoints = {};
    this.buffer = [];
    this.channelMapping = {};
    this.nextChannelIndex = 1;
    this.channelVisibility = {};
    this.legendButtons = [];
    this.lastGlobalIndex = {};
    this.lastGlobalIndexRender = 0;
    this.globalIndexStep = {};
    this.localIndex = {};
    this.lastMsOfMinuteFW = {};
    this.frozenTime = null;
    this.channelOrder = [];
    this.channelColorMap = {};
    this.hasReceivedFirstData = false;
    this.requestRedraw();
  }

  zoomToFitData() {
    const bounds = this.getDataBounds();
    if (!bounds) {
      return;
    }

    if (bounds.maxValue !== bounds.minValue) {
      const padding = (bounds.maxValue - bounds.minValue) * 0.1;
      this.yMin = bounds.minValue - padding;
      this.yMax = bounds.maxValue + padding;
    } else {
      this.yMin = bounds.minValue - 1;
      this.yMax = bounds.maxValue + 1;
    }
    this.requestRedraw();
  }

  setAutoFit(isValue) {
    this.isAutoFit = isValue;
    if (isValue) {
      this.zoomToFitData();
      this.isInteracting = false;
    } else {
      this.isInteracting = true;
    }
    this.onAutoFitChange(this.isAutoFit);
  }

  getAutoFit() {
    return this.isAutoFit;
  }

  toggleAutoFit() {
    this.setAutoFit(!this.isAutoFit);
  }

  /**
   * Thêm dữ liệu từ một channel vào buffer
   * @param {number[]} samples - Mảng giá trị sample
   * @param {number} samplingRate - Tần số lấy mẫu (Hz)
   * @param {string} channelName - Tên channel
   * @param {number} msOfMinuteFW - Timestamp (ms) của sample đầu tiên trong batch
   */
  addChartBuffer(samples, samplingRate, channelName, msOfMinuteFW) {
    if (!samples || samples.length === 0) return;

    // Tính khoảng thời gian giữa 2 sample liên tiếp theo BASE_TIME_UNIT
    const timeStep = this.BASE_TIME_UNIT / samplingRate;
    this.globalIndexStep[channelName] = timeStep;

    let missingSampleCount = 0;

    // Lần đầu nhận data cho channel
    if (!this.lastGlobalIndex[channelName]) {
      this.lastGlobalIndex[channelName] = this.lastGlobalIndexRender;
      this.localIndex[channelName] = 1; // Start local index from 1
    } else {
      // Tính số sample bị thiếu dựa trên thời gian
      let diffMsOfMinuteFW = msOfMinuteFW - this.lastMsOfMinuteFW[channelName];
      if (diffMsOfMinuteFW < 0) {
        diffMsOfMinuteFW = msOfMinuteFW + 60000 - this.lastMsOfMinuteFW[channelName];
      }
      const sampleIntervalMs = 1000 / samplingRate;
      const estimatedSampleCount = Math.floor(diffMsOfMinuteFW / sampleIntervalMs);
      const sampleCountInBatch = samples.length;

      // Nếu số sample ước tính lớn hơn nhiều so với thực tế -> bị mất data
      if (estimatedSampleCount > sampleCountInBatch * 1.5) {
        missingSampleCount = estimatedSampleCount - sampleCountInBatch;
        console.warn(
          `[CHART] Wrong msOfMinuteFW (Δ = ${diffMsOfMinuteFW} ms) [${channelName}]. Previous: ${this.lastMsOfMinuteFW[channelName]}, Current: ${msOfMinuteFW}`,
        );
        this.onMessageNotify(
          "warning",
          `[CHART] Missing samples [ Δ = ${missingSampleCount}, ${channelName}, freq = ${samplingRate} Hz]. Estimated: ${estimatedSampleCount}, Actual: ${sampleCountInBatch}`,
        );
      }
        if (estimatedSampleCount < sampleCountInBatch * 0.5) {
        const overtSampleCount = -estimatedSampleCount - sampleCountInBatch;
        console.warn(
          `[CHART] Wrong msOfMinuteFW (Δ = ${diffMsOfMinuteFW} ms) [${channelName}]. Previous: ${this.lastMsOfMinuteFW[channelName]}, Current: ${msOfMinuteFW}`,
        );
        this.onMessageNotify(
          "warning",
          `[CHART] Over samples [ Δ = ${overtSampleCount}, ${channelName}, freq = ${samplingRate} Hz]. Estimated: ${estimatedSampleCount}, Actual: ${sampleCountInBatch}`,
        );
      }
    }
    this.lastMsOfMinuteFW[channelName] = msOfMinuteFW;

    const dataPoints = [];
    let currentGlobalIndex = this.lastGlobalIndex[channelName];
    let localIndexCounter = this.localIndex[channelName];

    // Xử lý missing data: bỏ qua các sample bị thiếu (tính trực tiếp, không cần for loop)
    if (missingSampleCount > 0) {
      // Tính trực tiếp base time và raw index cho sample đầu tiên sau khoảng trống
      currentGlobalIndex += missingSampleCount * timeStep;
      localIndexCounter += missingSampleCount;
    }

    // Thêm các sample thực tế
    for (let i = 0; i < samples.length; i++) {
      dataPoints.push({
        value: samples[i],
        baseTime: currentGlobalIndex + i * timeStep, // Vị trí trên trục X (theo BASE_TIME_UNIT)
        localIndex: localIndexCounter + i, // Chỉ số sample gốc của channel
      });
    }

    // Cập nhật thông tin channel
    this.lastGlobalIndex[channelName] = currentGlobalIndex + samples.length * timeStep;
    this.localIndex[channelName] = localIndexCounter + samples.length;

    // console.log(`[CHART - addChartBuffer -new] ${channelName}: lastGlobalIndexRender: ${this.lastGlobalIndexRender}`);

    // Thêm vào buffer
    const idx = this.buffer.findIndex((item) => item.channel === channelName);
    if (idx >= 0) {
      this.buffer[idx].dataPoints.push(...dataPoints);
    } else {
      this.buffer.push({ channel: channelName, dataPoints });
    }
  }

  setLabels(...labels) {
    if (labels.length === 1 && Array.isArray(labels[0])) {
      this.customLabels = labels[0];
    } else {
      this.customLabels = labels;
    }

    this.channelOrder.forEach((ch, index) => {
      if (this.channelVisibility[ch] === undefined) {
        this.channelVisibility[ch] = true;
      }
    });

    this.requestRedraw();
  }

  autoRender() {
    if (this.chartTimer !== null) return;

    this.chartTimer = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(this.chartTimer);
        this.chartTimer = null;
        return;
      }
      this.lastGlobalIndexRender = this.lastGlobalIndexRender + this.RENDER_STEP;

      if (this.isPaused) {
        return;
      }

      let hasNewData = false;
      let shouldRedraw = false;

      const totalSensorCount = this.getTotalSensorCount();
      if (!this.hasReceivedFirstData && totalSensorCount > 0) {
        this.hasReceivedFirstData = true;
      }
      if (!this.hasReceivedFirstData) {
        return;
      }

      // === BƯỚC 1: CẬP NHẬT THỜI GIAN RENDER ===
      const newRenderTime = this.lastGlobalIndexRender;

      // === BƯỚC 2: XỬ LÝ DỮ LIỆU TỪ BUFFER ===
      let maxNewTime = 0;
      let hasAnyData = false;

      for (const item of this.buffer) {
        if (!item.dataPoints || item.dataPoints.length === 0) continue;

        const mappedChannel = this.getMappedChannel(item.channel);
        const target = this.dataPoints[mappedChannel];
        if (!target) continue;

        // Lấy dữ liệu mới theo bước RENDER_STEP
        const pointsToAdd = this.countPointsInRange(item.dataPoints, newRenderTime);

        if (pointsToAdd > 0) {
          const newPoints = item.dataPoints.splice(0, pointsToAdd);
          target.push(...newPoints);
          hasNewData = true;

          if (newPoints.length > 0) {
            const lastPoint = newPoints[newPoints.length - 1];
            if (lastPoint && lastPoint.baseTime > maxNewTime) {
              maxNewTime = lastPoint.baseTime;
            }
            hasAnyData = true;
          }
        }
      }

      // === BƯỚC 3: XÓA DỮ LIỆU CŨ ===
      if (hasNewData) {
        for (const channel in this.dataPoints) {
          this.removeOldData(this.dataPoints[channel], this.getCurrentGlobalIndex());
        }
      }

      // === BƯỚC 4: ĐỒNG BỘ THỜI GIAN RENDER ===
      if (hasNewData && hasAnyData) {
        const actualLastTime = this.getCurrentGlobalIndex();
        if (actualLastTime > this.lastGlobalIndexRender) {
          this.lastGlobalIndexRender = actualLastTime;
        } else if (maxNewTime > this.lastGlobalIndexRender) {
          this.lastGlobalIndexRender = maxNewTime;
        }
      }

      // === BƯỚC 5: CẬP NHẬT VIEW ===
      const currentTime = this.getCurrentGlobalIndex();
      this.viewOffset = this.lastGlobalIndexRender - currentTime;

      if (this.viewOffset < 0) {
        this.viewOffset = 0;
      }

      shouldRedraw = true;

      // === BƯỚC 6: VẼ LẠI ===
      if (shouldRedraw) {
        if (this.isAutoFit) {
          this.zoomToFitData();
        } else {
          this.requestRedraw();
        }
      }
    }, this.RENDER_INTERVAL_MS);
  }

  // ==================== HELPER METHODS ====================
  /**
   * Lấy thời gian hiện tại trên trục X (theo BASE_TIME_UNIT)
   * Nếu đang pause, trả về thời gian đã đóng băng
   */
  getCurrentGlobalIndex() {
    if (this.isPaused && this.frozenTime !== null) {
      return this.frozenTime;
    }
    if (Object.keys(this.dataPoints).length === 0) {
      return this.frozenTime || 0;
    }
    return this.getLastGlobalIndex();
  }

  /**
   * Lấy thời gian base lớn nhất từ tất cả các channel
   */
  getLastGlobalIndex() {
    let maxTime = 0;
    for (const channel in this.dataPoints) {
      const points = this.dataPoints[channel];
      if (points && points.length > 0) {
        const lastPoint = points[points.length - 1];
        if (lastPoint && lastPoint.baseTime > maxTime) {
          maxTime = lastPoint.baseTime;
        }
      }
    }
    return maxTime;
  }
  getTotalSensorCount() {
    const sensorSet = new Set();
    for (const item of this.buffer) {
      if (!item.dataPoints || item.dataPoints.length === 0) continue;
      const match = item.channel.match(/^(data_type_\d+)_ch_\d+$/);
      if (match) sensorSet.add(match[1]);
    }
    return sensorSet.size;
  }

  getMappedChannel(originalChannel) {
    if (this.channelMapping[originalChannel]) {
      return this.channelMapping[originalChannel];
    }

    const match = originalChannel.match(/^(data_type_\d+)_ch_(\d+)$/);
    if (match) {
      const dataType = match[1];
      const channel = Number(match[2]);
      const prefix = CONSTANTS.STREAM_TYPES[dataType].nameChartLabel ?? CONSTANTS.DEFAULT_SENSOR_NAME;
      const mappedChannel = `${prefix}${channel + 1}`;
      this.channelMapping[originalChannel] = mappedChannel;

      if (!this.dataPoints[mappedChannel]) {
        this.dataPoints[mappedChannel] = [];
        this.channelVisibility[mappedChannel] = true;
        this.channelOrder.push(mappedChannel);
      }
      return mappedChannel;
    }

    return originalChannel;
  }

  removeOldData(target, currentTime) {
    let count = 0;
    const cutoffTime = currentTime - this.MAX_DATA_KEEP;
    while (count < target.length && target[count].baseTime <= cutoffTime) {
      count++;
    }
    if (count > 0) {
      target.splice(0, count);
    }
  }

  countPointsInRange(dataPoints, endTime) {
    let count = 0;
    for (let i = 0; i < dataPoints.length; i++) {
      if (dataPoints[i].baseTime > endTime) {
        break;
      }
      count++;
    }
    return count;
  }

  // ==================== EVENT HANDLERS ====================

  setupEvents() {
    window.addEventListener("resize", () => this.resize());
    this.resize();

    this.canvas.addEventListener("mousemove", (e) => this.handleMouseMove(e));
    this.canvas.addEventListener("mousedown", (e) => this.handleMouseDown(e));
    this.canvas.addEventListener("mouseup", (e) => this.handleMouseUp(e));
    this.canvas.addEventListener("click", (e) => this.handleCanvasClick(e));

    this.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      return false;
    });

    window.addEventListener("mouseup", () => {
      this.dragMode = null;
    });
  }

  handleMouseUp(e) {
    this.isDragging = false;
  }

  clampViewDuration(duration) {
    return Math.max(this.MIN_VIEW_DURATION, Math.min(this.MAX_VIEW_DURATION, duration));
  }

  getActiveWidthDpr(dpr) {
    return this.canvas.width - (this.margins.left + this.margins.right) * dpr;
  }

  getActiveHeightDpr(dpr) {
    return this.canvas.height - (this.margins.top + this.margins.bottom) * dpr;
  }

  isInsidePlotArea(x, y, dpr) {
    return (
      x >= this.margins.left * dpr &&
      x <= this.canvas.width - this.margins.right * dpr &&
      y >= this.margins.top * dpr &&
      y <= this.canvas.height - this.margins.bottom * dpr
    );
  }

  getDataBounds() {
    let minTime = Infinity;
    let maxTime = -Infinity;
    let minValue = Infinity;
    let maxValue = -Infinity;
    let hasData = false;

    this.channelOrder.forEach((channel) => {
      if (!this.getChannelVisibility(channel)) {
        return;
      }

      const points = this.dataPoints[channel];
      if (!Array.isArray(points) || points.length === 0) return;

      points.forEach((point) => {
        const time = typeof point === "object" && point !== null ? point.baseTime : null;
        const value = typeof point === "object" && point !== null ? point.value : point;

        if (typeof time === "number" && Number.isFinite(time)) {
          minTime = Math.min(minTime, time);
          maxTime = Math.max(maxTime, time);
          hasData = true;
        }

        if (typeof value === "number" && Number.isFinite(value)) {
          minValue = Math.min(minValue, value);
          maxValue = Math.max(maxValue, value);
          hasData = true;
        }
      });
    });

    if (!hasData) return null;
    return { minTime, maxTime, minValue, maxValue };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;
    this.requestRedraw();
  }

  requestRedraw() {
    if (this.drawPending) return;
    this.drawPending = true;
    requestAnimationFrame(() => {
      this.draw();
      this.drawPending = false;
    });
  }

  // ==================== HÀM CHUYỂN ĐỔI TỌA ĐỘ ====================

  /**
   * Chuyển đổi thời gian base thành tọa độ X trên canvas
   */
  getX(baseTime, minTime, activeWidth, dpr) {
    return this.margins.left * dpr + ((baseTime - minTime) / this.VIEW_DURATION) * activeWidth;
  }

  /**
   * Chuyển đổi giá trị thành tọa độ Y trên canvas
   */
  getY(val, activeHeight, height, dpr) {
    const range = this.yMax - this.yMin;
    const ratio = (val - this.yMin) / range;
    return height - this.margins.bottom * dpr - ratio * activeHeight;
  }

  getLegendButtonAt(x, y) {
    for (const button of this.legendButtons) {
      if (x >= button.x && x <= button.x + button.width && y >= button.y && y <= button.y + button.height) {
        return button;
      }
    }
    return null;
  }

  // ==================== MOUSE HANDLERS ====================

  handleMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    if (this.mouseDownX !== 0 || this.mouseDownY !== 0) {
      const dx = e.clientX - this.mouseDownX;
      const dy = e.clientY - this.mouseDownY;
      if (Math.sqrt(dx * dx + dy * dy) > 5) {
        this.isDragging = true;
      }
    }

    if (this.dragMode === "pan-x") {
      const deltaX = e.clientX - this.startPanX;
      const activeWidth = this.canvas.width / dpr - this.margins.left - this.margins.right;
      this.viewOffset = Math.min(0, this.originalViewOffset - deltaX * (this.VIEW_DURATION / activeWidth));
      this.hoverPoint = null;
      this.requestRedraw();
      return;
    }

    if (this.dragMode === "pan-y") {
      const deltaY = e.clientY - this.startPanY;
      const activeHeight = this.canvas.height / dpr - this.margins.top - this.margins.bottom;
      const yRange = this.originalYMax - this.originalYMin;
      const deltaYValue = deltaY * (yRange / activeHeight);

      this.yMin = this.originalYMin + deltaYValue;
      this.yMax = this.originalYMax + deltaYValue;
      this.hoverPoint = null;
      this.requestRedraw();
      return;
    }

    if (this.dragMode === "zoom-x") {
      const deltaX = e.clientX - this.zoomStartX;
      const sensitivity = 0.005;
      let factor = 1 + deltaX * sensitivity;
      factor = Math.max(0.2, Math.min(5, factor));
      let newDuration = this.zoomOriginalDuration * factor;
      newDuration = this.clampViewDuration(newDuration);

      const currentTime = this.getCurrentGlobalIndex();
      const targetTime = this.zoomStartDataValue;
      const ratio = this.zoomStartMouseRatio;
      const newMinTime = targetTime - ratio * newDuration;
      const newNow = newMinTime + newDuration;
      this.viewOffset = newNow - currentTime;
      this.VIEW_DURATION = newDuration;
      this.requestRedraw();
      return;
    }

    if (this.dragMode === "zoom-y") {
      const deltaY = this.zoomStartY - e.clientY;
      const sensitivity = 0.005;
      let factor = 1 - deltaY * sensitivity;
      factor = Math.max(0.2, Math.min(5, factor));
      const originalRange = this.zoomOriginalYMax - this.zoomOriginalYMin;
      let newRange = originalRange * factor;
      if (newRange < 1e-9) newRange = 1e-9;

      const targetValue = this.zoomStartDataValue;
      const ratio = (targetValue - this.zoomOriginalYMin) / originalRange;
      const newYMin = targetValue - ratio * newRange;
      const newYMax = newYMin + newRange;

      if (newYMin < newYMax) {
        this.yMin = newYMin;
        this.yMax = newYMax;
      }
      this.requestRedraw();
      return;
    }

    this.mouseX = (e.clientX - rect.left) * dpr;
    this.updateHoverPoint(dpr);
    this.requestRedraw();
    this.updateCursorStyle(e, dpr);
  }

  updateCursorStyle(e, dpr) {
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * dpr;
    const mouseY = (e.clientY - rect.top) * dpr;

    if (this.getLegendButtonAt(mouseX, mouseY)) {
      this.canvas.style.cursor = "pointer";
      return;
    }

    const onXAxis =
      mouseY >= this.canvas.height - this.margins.bottom * dpr &&
      mouseX >= this.margins.left * dpr &&
      mouseX <= this.canvas.width - this.margins.right * dpr;
    const onYAxis =
      mouseX <= this.margins.left * dpr &&
      mouseY >= this.margins.top * dpr &&
      mouseY <= this.canvas.height - this.margins.bottom * dpr;
    const onPlotArea = this.isInsidePlotArea(mouseX, mouseY, dpr);

    if (onXAxis) {
      this.canvas.style.cursor = "ew-resize";
    } else if (onYAxis) {
      this.canvas.style.cursor = "ns-resize";
    } else if (onPlotArea) {
      this.canvas.style.cursor = "grab";
    } else {
      this.canvas.style.cursor = "default";
    }
  }

  handleMouseDown(e) {
    this.mouseDownX = e.clientX;
    this.mouseDownY = e.clientY;
    this.isDragging = false;

    if (this.isAutoFit) {
      this.setAutoFit(false);
    }

    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const clickX = (e.clientX - rect.left) * dpr;
    const clickY = (e.clientY - rect.top) * dpr;
    const isRightClick = e.button === 2;
    const isLeftClick = e.button === 0;

    const onXAxis =
      clickY >= this.canvas.height - this.margins.bottom * dpr &&
      clickX >= this.margins.left * dpr &&
      clickX <= this.canvas.width - this.margins.right * dpr;
    const onYAxis =
      clickX <= this.margins.left * dpr &&
      clickY >= this.margins.top * dpr &&
      clickY <= this.canvas.height - this.margins.bottom * dpr;
    const onPlotArea = this.isInsidePlotArea(clickX, clickY, dpr);

    if (isRightClick && onPlotArea) {
      e.preventDefault();

      this.startPanX = e.clientX;
      this.startPanY = e.clientY;
      this.originalViewOffset = this.viewOffset;
      this.originalYMin = this.yMin;
      this.originalYMax = this.yMax;

      let directionDetermined = false;
      let moveListener = null;
      let upListener = null;

      const determineDirection = (moveEvent) => {
        if (directionDetermined) return;

        const deltaX = moveEvent.clientX - this.startPanX;
        const deltaY = moveEvent.clientY - this.startPanY;

        if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
          directionDetermined = true;
          this.dragMode = Math.abs(deltaX) > Math.abs(deltaY) ? "pan-x" : "pan-y";

          if (moveListener) {
            window.removeEventListener("mousemove", moveListener);
          }
        }
      };

      const onMouseUp = () => {
        if (moveListener) {
          window.removeEventListener("mousemove", moveListener);
        }
        if (upListener) {
          window.removeEventListener("mouseup", upListener);
        }

        if (!directionDetermined) {
          this.dragMode = null;
        }
      };

      moveListener = determineDirection;
      upListener = onMouseUp;

      window.addEventListener("mousemove", moveListener);
      window.addEventListener("mouseup", upListener);
      return;
    }

    if (isLeftClick && onXAxis) {
      e.preventDefault();
      this.dragMode = "zoom-x";
      this.zoomStartX = e.clientX;
      this.zoomStartY = e.clientY;
      this.zoomOriginalDuration = this.VIEW_DURATION;

      const currentTime = this.getCurrentGlobalIndex();
      const now = currentTime + this.viewOffset;
      const minTime = now - this.VIEW_DURATION;
      const activeWidth = this.getActiveWidthDpr(dpr);
      const relativeX = Math.max(0, Math.min(activeWidth, clickX - this.margins.left * dpr));
      const ratio = relativeX / activeWidth;

      this.zoomStartDataValue = minTime + ratio * this.VIEW_DURATION;
      this.zoomStartMouseRatio = ratio;
      return;
    }

    if (isLeftClick && onYAxis) {
      e.preventDefault();
      this.dragMode = "zoom-y";
      this.zoomStartX = e.clientX;
      this.zoomStartY = e.clientY;
      this.zoomOriginalYMin = this.yMin;
      this.zoomOriginalYMax = this.yMax;

      const activeH = this.getActiveHeightDpr(dpr);
      const relativeY = Math.max(0, Math.min(activeH, clickY - this.margins.top * dpr));
      const ratio = 1 - relativeY / activeH;

      this.zoomStartDataValue = this.yMin + ratio * (this.yMax - this.yMin);
      return;
    }
  }

  handleCanvasClick(e) {
    if (this.isDragging) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const clickX = (e.clientX - rect.left) * dpr;
    const clickY = (e.clientY - rect.top) * dpr;

    const clickedButton = this.getLegendButtonAt(clickX, clickY);
    if (clickedButton) {
      const channel = clickedButton.channel;
      const currentVisibility = this.getChannelVisibility(channel);
      this.channelVisibility[channel] = !currentVisibility;

      this.setAutoFit(true);
      e.stopPropagation();
    }
  }

  // ==================== HOVER / TOOLTIP ====================

  updateHoverPoint(dpr) {
    const currentTime = this.getCurrentGlobalIndex();
    const now = currentTime + this.viewOffset;
    const minTime = now - this.VIEW_DURATION;
    const maxTime = now;
    const activeWidth = this.getActiveWidthDpr(dpr);

    if (this.mouseX >= this.margins.left * dpr && this.mouseX <= this.canvas.width - this.margins.right * dpr) {
      const ratio = (this.mouseX - this.margins.left * dpr) / activeWidth;
      const targetGlobalIndex = minTime + ratio * this.VIEW_DURATION;

      const pointsAtTime = [];

      // Tạo reverse mapping từ mappedChannel -> originalChannel
      const reverseMapping = {};
      for (const [orig, mapped] of Object.entries(this.channelMapping)) {
        reverseMapping[mapped] = orig;
      }

      for (const mappedChannel in this.dataPoints) {
        if (!this.getChannelVisibility(mappedChannel)) {
          continue;
        }

        const points = this.dataPoints[mappedChannel];
        if (!points || points.length === 0) continue;

        // Lấy original channel name để tìm timeStep
        const originalChannel = reverseMapping[mappedChannel] || mappedChannel;
        const timeStep = this.globalIndexStep[originalChannel] || this.BASE_TIME_UNIT * 0.1;

        const MAX_TIME_GAP = this.BASE_TIME_UNIT / 2; // 0.5s gap threshold

        let closestPoint = null;
        let closestIndex = -1;
        let minDiff = Infinity;

        const searchMargin = this.VIEW_DURATION * 0.1;
        for (let i = 0; i < points.length; i++) {
          const p = points[i];
          if (p.baseTime < minTime - searchMargin || p.baseTime > maxTime + searchMargin) {
            continue;
          }

          const diff = Math.abs(p.baseTime - targetGlobalIndex);
          if (diff < minDiff) {
            minDiff = diff;
            closestPoint = p;
            closestIndex = i;
          }
        }

        if (!closestPoint) continue;

        let shouldShow = true;

        if (minDiff > timeStep * 2) {
          shouldShow = false;
        }

        if (closestPoint.baseTime < minTime || closestPoint.baseTime > maxTime) {
          shouldShow = false;
        }

        if (shouldShow && closestIndex >= 0) {
          if (closestIndex > 0) {
            const prevPoint = points[closestIndex - 1];
            if (prevPoint.baseTime >= minTime && prevPoint.baseTime <= maxTime) {
              const rawGap = closestPoint.localIndex - prevPoint.localIndex;
              if (rawGap > 1 && minDiff > timeStep * 0.5) {
                shouldShow = false;
              }
            }
          }

          if (shouldShow && closestIndex < points.length - 1) {
            const nextPoint = points[closestIndex + 1];
            if (nextPoint.baseTime >= minTime && nextPoint.baseTime <= maxTime) {
              const rawGap = nextPoint.localIndex - closestPoint.localIndex;
              if (rawGap > 1 && minDiff > timeStep * 0.5) {
                shouldShow = false;
              }
            }
          }
        }

        if (shouldShow) {
          // LƯU GIỮ NGUYÊN baseTime CỦA TỪNG ĐIỂM
          pointsAtTime.push({
            ...closestPoint,
            channel: mappedChannel,
            // Thêm trường displayTime để hiển thị trên tooltip
            displayTime: closestPoint.baseTime,
          });
        }
      }

      // SỬA: Nếu có điểm tìm được, sử dụng baseTime của điểm đầu tiên làm vị trí hover
      if (pointsAtTime.length > 0) {
        // Lấy baseTime của điểm đầu tiên (hoặc điểm có giá trị gần nhất với cursor)
        // Sắp xếp các điểm theo khoảng cách đến targetGlobalIndex
        pointsAtTime.sort((a, b) => {
          const diffA = Math.abs(a.baseTime - targetGlobalIndex);
          const diffB = Math.abs(b.baseTime - targetGlobalIndex);
          return diffA - diffB;
        });

        // Sử dụng baseTime của điểm gần nhất với cursor làm vị trí đường thẳng đứng
        const closestPoint = pointsAtTime[0];
        this.hoverPoint = {
          baseTime: closestPoint.baseTime, // Dùng baseTime của điểm gần nhất
          points: pointsAtTime,
          cursorTime: targetGlobalIndex, // Lưu lại cursor time để tham khảo
        };
      } else {
        this.hoverPoint = null;
      }
    } else {
      this.hoverPoint = null;
    }
  }

  getChannelVisibility(channel) {
    return this.channelVisibility[channel] !== undefined ? this.channelVisibility[channel] : true;
  }

  // ==================== VẼ CHART ====================

  draw() {
    if (!this.ctx) return;

    const { width, height } = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    this.ctx.clearRect(0, 0, width, height);

    const currentTime = this.getCurrentGlobalIndex();
    const now = currentTime + this.viewOffset;
    const minTime = now - this.VIEW_DURATION;
    const maxTime = now;
    const activeW = width - (this.margins.left + this.margins.right) * dpr;
    const activeH = height - (this.margins.top + this.margins.bottom) * dpr;

    // console.log(`[draw] min_view_X=${minTime}, max_view_X=${maxTime}`);

    // ===== VẼ LƯỚI NGANG (Y-AXIS) =====
    const rangeY = this.yMax - this.yMin;
    const roughStep = rangeY / 5;
    const exponent = Math.floor(Math.log10(roughStep));
    const stepY =
      Math.pow(10, exponent) *
      (roughStep / Math.pow(10, exponent) >= 5 ? 5 : roughStep / Math.pow(10, exponent) >= 2 ? 2 : 1);
    const startY = Math.ceil(this.yMin / stepY) * stepY;

    for (let v = startY; v <= this.yMax + stepY * 0.001; v += stepY) {
      if (v < this.yMin) continue;
      const y = this.getY(v, activeH, height, dpr);
      this.ctx.strokeStyle = "rgba(30, 41, 59, 0.5)";
      this.ctx.beginPath();
      this.ctx.moveTo(this.margins.left * dpr, y);
      this.ctx.lineTo(width - this.margins.right * dpr, y);
      this.ctx.stroke();
      this.ctx.fillStyle = "rgba(148, 163, 184, 0.9)";
      this.ctx.font = `${10 * dpr}px Inter`;
      this.ctx.textAlign = "right";
      this.ctx.textBaseline = "middle";
      this.ctx.fillText(v.toFixed(1), (this.margins.left - 10) * dpr, y);
    }

    // ===== VẼ LƯỚI DỌC (X-AXIS) =====
    const stepX = Math.ceil(this.VIEW_DURATION / 10 / 100) * 100;
    const startTime = Math.ceil(minTime / stepX) * stepX;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "top";

    for (let t = startTime; t <= maxTime; t += stepX) {
      const x = this.getX(t, minTime, activeW, dpr);
      if (x >= this.margins.left * dpr && x <= width - this.margins.right * dpr) {
        this.ctx.strokeStyle = "rgba(30, 41, 59, 0.4)";
        this.ctx.beginPath();
        this.ctx.moveTo(x, this.margins.top * dpr);
        this.ctx.lineTo(x, height - this.margins.bottom * dpr);
        this.ctx.stroke();
        this.ctx.fillStyle = "rgba(148, 163, 184, 0.8)";
        this.ctx.font = `${9 * dpr}px Inter`;

        // Hiển thị giá trị GLOBAL INDEX in x-axis (đã làm tròn)
        const SHOW_X_LABEL = false;
        if (SHOW_X_LABEL) {
          const displayTime = Math.round(t);
          this.ctx.fillText(displayTime.toString(), x, height - this.margins.bottom * dpr + 5 * dpr);
        }
      }
    }

    // ===== VẼ KHUNG BIỂU ĐỒ =====
    this.ctx.strokeStyle = "rgba(51, 65, 85, 0.8)";
    this.ctx.lineWidth = 1.5 * dpr;
    this.ctx.beginPath();
    this.ctx.moveTo(this.margins.left * dpr, this.margins.top * dpr);
    this.ctx.lineTo(this.margins.left * dpr, height - this.margins.bottom * dpr);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.moveTo(this.margins.left * dpr, height - this.margins.bottom * dpr);
    this.ctx.lineTo(width - this.margins.right * dpr, height - this.margins.bottom * dpr);
    this.ctx.stroke();

    // ===== CLIP VÙNG VẼ =====
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(this.margins.left * dpr, this.margins.top * dpr, activeW, activeH);
    this.ctx.clip();

    // ===== PALETTE MÀU =====
    const palette = [
      { color: "#3b82f6", fill: "rgba(59,130,246,0.15)" },
      { color: "#ef4444", fill: "rgba(239,68,68,0.15)" },
      { color: "#22c55e", fill: "rgba(34,197,94,0.15)" },
      { color: "#eab308", fill: "rgba(234,179,8,0.15)" },
      { color: "#a855f7", fill: "rgba(168,85,247,0.15)" },
      { color: "#06b6d4", fill: "rgba(6,182,212,0.15)" },
      { color: "#f97316", fill: "rgba(249,115,22,0.15)" },
      { color: "#84cc16", fill: "rgba(132,204,22,0.15)" },
      { color: "#14b8a6", fill: "rgba(20,184,166,0.15)" },
      { color: "#4B5563", fill: "rgba(75,85,99,0.15)" },
    ];

    let hasData = false;
    const sortedChannels = this.channelOrder;

    // ===== VẼ DỮ LIỆU CHO TỪNG CHANNEL =====
    sortedChannels.forEach((channel, idx) => {
      if (!this.getChannelVisibility(channel)) {
        return;
      }

      const points = this.dataPoints[channel];
      if (!Array.isArray(points) || points.length === 0) return;

      const config = palette[idx % palette.length];
      const timeStep = this.globalIndexStep[channel] || 1;

      // Tìm các điểm trong vùng hiển thị
      let visiblePoints = [];
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p.baseTime >= minTime && p.baseTime <= maxTime) {
          visiblePoints.push(p);
        }
      }

      if (visiblePoints.length === 0) return;
      hasData = true;

      // ===== Tìm các segment (khoảng dữ liệu liên tục) =====
      // Maximum allowed distance between two points to split segments
      const MAX_TIME_GAP = this.BASE_TIME_UNIT / 2;
      const segments = [];
      let currentSegment = [];

      for (let i = 0; i < visiblePoints.length; i++) {
        const p = visiblePoints[i];

        if (i === 0) {
          currentSegment.push(p);
        } else {
          const prevP = visiblePoints[i - 1];
          const gap = p.baseTime - prevP.baseTime;

          if (gap > MAX_TIME_GAP) {
            if (currentSegment.length > 0) {
              segments.push(currentSegment);
              currentSegment = [];
            }
          }
          currentSegment.push(p);
        }
      }

      if (currentSegment.length > 0) {
        segments.push(currentSegment);
      }

      // ===== VẼ FILL AREA cho từng segment =====
      const IS_FILL_AREA_CHART = false;
      if (IS_FILL_AREA_CHART) {
        segments.forEach((segment) => {
          if (segment.length < 2) return;

          this.ctx.beginPath();

          const firstP = segment[0];
          const lastP = segment[segment.length - 1];

          this.ctx.moveTo(
            this.getX(firstP.baseTime, minTime, activeW, dpr),
            this.getY(firstP.value, activeH, height, dpr),
          );

          for (let i = 1; i < segment.length; i++) {
            const p = segment[i];
            this.ctx.lineTo(this.getX(p.baseTime, minTime, activeW, dpr), this.getY(p.value, activeH, height, dpr));
          }

          this.ctx.lineTo(this.getX(lastP.baseTime, minTime, activeW, dpr), this.getY(this.yMin, activeH, height, dpr));
          this.ctx.lineTo(
            this.getX(firstP.baseTime, minTime, activeW, dpr),
            this.getY(this.yMin, activeH, height, dpr),
          );
          this.ctx.closePath();

          const grad = this.ctx.createLinearGradient(
            0,
            this.getY(this.yMax, activeH, height, dpr),
            0,
            this.getY(this.yMin, activeH, height, dpr),
          );
          grad.addColorStop(0, config.fill);
          grad.addColorStop(1, "rgba(0, 0, 0, 0)");
          this.ctx.fillStyle = grad;
          this.ctx.fill();
        });
      }

      // ===== VẼ ĐƯỜNG LINE cho từng segment =====
      segments.forEach((segment) => {
        if (segment.length < 2) return;

        this.ctx.beginPath();

        this.ctx.moveTo(
          this.getX(segment[0].baseTime, minTime, activeW, dpr),
          this.getY(segment[0].value, activeH, height, dpr),
        );

        for (let i = 1; i < segment.length; i++) {
          const p = segment[i];
          this.ctx.lineTo(this.getX(p.baseTime, minTime, activeW, dpr), this.getY(p.value, activeH, height, dpr));
        }

        this.ctx.strokeStyle = config.color;
        this.ctx.lineWidth = 2.5 * dpr;
        this.ctx.lineCap = "round";
        this.ctx.lineJoin = "round";
        this.ctx.shadowColor = config.color + "66";
        this.ctx.shadowBlur = 4 * dpr;
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;
      });
    });

    // ===== HIỂN THỊ THÔNG BÁO KHI KHÔNG CÓ DỮ LIỆU =====
    if (!hasData) {
      this.ctx.fillStyle = "rgba(148, 163, 184, 0.4)";
      this.ctx.font = `${12 * dpr}px Inter`;
      this.ctx.textAlign = "center";
      this.ctx.fillText("Press 'Start' to activate plot graphs", (this.margins.left * dpr + width) / 2, height / 2);
    }
    this.ctx.restore();

    // ===== VẼ LEGEND (HIỂN THỊ TẤT CẢ CHANNEL, KỂ CẢ ĐANG ẨN) =====
    this.ctx.save();
    this.ctx.textBaseline = "middle";
    this.ctx.textAlign = "left";
    let legendX = (this.margins.left + 10) * dpr;
    const legendY = (this.margins.top + 15) * dpr;

    this.legendButtons = [];

    // Duyệt qua TẤT CẢ channel (không chỉ channel đang hiển thị)
    sortedChannels.forEach((channel, i) => {
      const config = palette[i % palette.length];
      const isVisible = this.getChannelVisibility(channel);
      const label = this.customLabels[i] || channel;

      this.ctx.font = `bold ${10 * dpr}px Inter`;
      const textWidth = this.ctx.measureText(label).width;
      const buttonWidth = textWidth + 28 * dpr;
      const buttonHeight = 22 * dpr;
      const buttonX = legendX - 2 * dpr;
      const buttonY = legendY - buttonHeight / 2;

      // Lưu thông tin button để xử lý click
      this.legendButtons.push({
        x: buttonX,
        y: buttonY,
        width: buttonWidth,
        height: buttonHeight,
        channel: channel,
      });

      // Vẽ background button
      this.ctx.beginPath();
      this.ctx.roundRect(buttonX, buttonY, buttonWidth, buttonHeight, 4 * dpr);

      if (isVisible) {
        this.ctx.fillStyle = config.color + "33"; // Màu nền khi hiển thị
      } else {
        this.ctx.fillStyle = "rgba(51, 65, 85, 0.6)"; // Màu nền khi ẩn (tối hơn)
      }
      this.ctx.fill();

      // Vẽ viền button
      this.ctx.strokeStyle = isVisible ? config.color : "rgba(100, 116, 139, 0.5)";
      this.ctx.lineWidth = 1.5 * dpr;
      this.ctx.stroke();

      // Vẽ dot (hình tròn nhỏ bên trái label)
      this.ctx.beginPath();
      this.ctx.arc(legendX + 6 * dpr, legendY, 4 * dpr, 0, Math.PI * 2);
      this.ctx.fillStyle = isVisible ? config.color : "rgba(100, 116, 139, 0.4)";
      this.ctx.fill();

      // Nếu đang hiển thị, vẽ viền trắng cho dot
      if (isVisible) {
        this.ctx.strokeStyle = "#ffffff";
        this.ctx.lineWidth = 1 * dpr;
        this.ctx.stroke();
      }

      // Vẽ text label
      this.ctx.fillStyle = isVisible ? "rgba(226, 232, 240, 0.9)" : "rgba(148, 163, 184, 0.5)";
      this.ctx.font = `bold ${10 * dpr}px Inter`;
      this.ctx.fillText(label, legendX + 14 * dpr, legendY);

      // Cập nhật vị trí cho button tiếp theo
      legendX += buttonWidth + 12 * dpr;
    });
    this.ctx.restore();

    // ===== VẼ TOOLTIP =====
    if (Object.keys(this.dataPoints).length === 0) {
      return;
    }

    if (this.hoverPoint && this.hoverPoint.points && this.mouseX !== null) {
      // Sử dụng baseTime của điểm gần nhất với cursor để vẽ đường thẳng đứng
      const hx = this.getX(this.hoverPoint.baseTime, minTime, activeW, dpr);

      if (hx >= this.margins.left * dpr && hx <= width - this.margins.right * dpr) {
        // Vẽ đường thẳng đứng tại vị trí hover
        this.ctx.strokeStyle = "rgba(226, 232, 240, 0.3)";
        this.ctx.lineWidth = 1 * dpr;
        this.ctx.setLineDash([4 * dpr, 4 * dpr]);
        this.ctx.beginPath();
        this.ctx.moveTo(hx, this.margins.top * dpr);
        this.ctx.lineTo(hx, height - this.margins.bottom * dpr);
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        // Vẽ các điểm tròn tại vị trí hover - SỬ DỤNG baseTime CỦA TỪNG ĐIỂM
        this.hoverPoint.points.forEach((p) => {
          // Sử dụng baseTime riêng của từng điểm để vẽ
          const px = this.getX(p.baseTime, minTime, activeW, dpr);
          const py = this.getY(p.value, activeH, height, dpr);
          const channelIdx = sortedChannels.indexOf(p.channel);
          const config = palette[channelIdx % palette.length];
          this.ctx.beginPath();
          this.ctx.arc(px, py, 5 * dpr, 0, Math.PI * 2);
          this.ctx.fillStyle = config.color;
          this.ctx.strokeStyle = "#ffffff";
          this.ctx.lineWidth = 1.5 * dpr;
          this.ctx.fill();
          this.ctx.stroke();
        });

        // Vẽ tooltip box
        const lineH = 18 * dpr;
        const tw = 200 * dpr;
        const th = (28 + this.hoverPoint.points.length * lineH) * dpr;
        let tx = hx + 15 * dpr;
        let ty = height / 2 - th / 2;
        if (tx + tw > width - this.margins.right * dpr) tx = hx - tw - 15 * dpr;

        this.ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
        this.ctx.strokeStyle = "rgba(148, 163, 184, 0.5)";
        this.ctx.beginPath();
        this.ctx.roundRect(tx, ty, tw, th, 6 * dpr);
        this.ctx.fill();
        this.ctx.stroke();

        // Nội dung tooltip - HIỂN THỊ ĐÚNG GIÁ TRỊ CỦA TỪNG ĐIỂM
        this.ctx.textAlign = "left";
        this.ctx.textBaseline = "top";

        // Sắp xếp các điểm theo channel order để hiển thị nhất quán
        const sortedPoints = this.hoverPoint.points.sort((a, b) => {
          return sortedChannels.indexOf(a.channel) - sortedChannels.indexOf(b.channel);
        });

        sortedPoints.forEach((p, i) => {
          const channelIdx = sortedChannels.indexOf(p.channel);
          const config = palette[channelIdx % palette.length];
          const label = this.customLabels[channelIdx] || `Sensor ${String.fromCharCode(65 + (channelIdx % 26))}`;

          // HIỂN THỊ GIÁ TRỊ THỰC TẾ CỦA ĐIỂM (p.value) và localIndex thực tế (p.localIndex)
          const rawIdx = p.localIndex !== undefined ? Math.round(p.localIndex) : Math.round(p.baseTime);

          this.ctx.fillStyle = config.color;
          this.ctx.font = `bold ${10 * dpr}px Inter`;

          // Show only local index in tooltip for simplicity
          let displayText = `${label}   ${p.value.toFixed(2)}   (idx: ${rawIdx})`;
          const SHOW_GLOBAL_LOCAL_INDEX = false;
          if (SHOW_GLOBAL_LOCAL_INDEX) {
            // Show local and global index in tooltip for clarity
            displayText = `${label}   ${p.value.toFixed(2)}   (idx: ${rawIdx}, global: ${Math.round(p.baseTime)})`;
          }

          this.ctx.fillText(displayText, tx + 10 * dpr, ty + (26 + i * lineH) * dpr);
        });
      }
    }
  }
}

const CHART = new ChartManager();

export default {
  init: (canvas) => CHART.init(canvas),
  start: () => CHART.start(),
  stop: () => CHART.stop(),
  freezeCurrentView: () => CHART.freezeCurrentView(),
  unfreeze: () => CHART.unfreeze(),
  clear: () => CHART.clear(),
  zoomToFitData: () => CHART.zoomToFitData(),
  setAutoFit: (isValue) => CHART.setAutoFit(isValue),
  getAutoFit: () => CHART.getAutoFit(),
  toggleAutoFit: () => CHART.toggleAutoFit(),
  addChartBuffer: (samples, samplingRate, channelName, msOfMinuteFW) =>
    CHART.addChartBuffer(samples, samplingRate, channelName, msOfMinuteFW),
  setLabels: (...labels) => CHART.setLabels(...labels),
  onAutoFitChange: (fn) => (CHART.onAutoFitChange = fn),
  onMessageNotify: (fn) => (CHART.onMessageNotify = fn),
};
