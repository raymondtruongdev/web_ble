// ============================================================
// ChartManager – vẽ đồ thị PPG lên Canvas, quản lý hover & pan
// - Click trái + kéo: Zoom trên trục X/Y
// - Click phải + kéo ngang: Pan theo trục X
// - Click phải + kéo dọc: Pan theo trục Y
// - Click vào label: Toggle hiển thị đường tương ứng
// ============================================================

const Utils = {
  bootTime: Date.now() - performance.now(),
  getRealTime(perfTime) {
    return new Date(this.bootTime + perfTime);
  },
  formatRealTime(date) {
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    const s = String(date.getSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  },
  formatRealTimeWithMs(date) {
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    const s = String(date.getSeconds()).padStart(2, "0");
    const ms = String(date.getMilliseconds()).padStart(3, "0");
    return `${h}:${m}:${s}.${ms}`;
  },
};

class ChartManager {
  constructor() {
    this.TIME_RENDER_CHART_MS = 20; // Duration for a timer to render chart 1000/20 = 50fps
    this.VIEW_DURATION_MS = 10 * 1000; // Chart will show the last 10s data
    this.MAX_DURATION_VIEW_IN_CHART = 30 * 1000; // Maximum  data point keep in chart is 30 second

    this.buffer = [];
    this.chartTimer = null;
    this.canvas = null;
    this.ctx = null;
    this.dataPoints = {};
    this.customLabels = [];
    this.channelMapping = {}; // Mapping originalChannel -> ch1, ch2, ch3
    this.nextChannelIndex = 1; // Start name is "ch1"
    this.margins = { left: 70, right: 20, top: 30, bottom: 40 };
    this.viewOffsetMs = 0;
    this.hoverPoint = null;
    this.mouseX = null;
    this.dragMode = null; // 'pan-x', 'pan-y', 'zoom-x', 'zoom-y'
    this.startPanX = 0;
    this.startPanY = 0;
    this.originalViewOffsetMs = 0;
    this.originalYMin = 0;
    this.originalYMax = 0;

    // chart states
    this.isRunning = false; // Flag indicating whether the chart is actively running and rendering
    this.isPaused = false; // Flag indicating whether the chart viewport is paused/frozen
    this.drawPending = false; // Flag to prevent duplicate requests
    this.isAutoFit = true; // Mặc định bật AutoFit
    this.freezeTime = null;

    // For zoom-in  X
    this.MIN_VIEW_DURATION_MS = 100; // Min duration for X axis in ms while zooming in
    this.MAX_VIEW_DURATION_MS = 60000; // Max duration for X axis in ms while zooming out

    // Initial limit value for Y
    this.yMin = -2000;
    this.yMax = 2000;

    // Drag-to-zoom trên trục (chuột trái)
    this.axisZoomStartX = 0;
    this.axisZoomStartY = 0;
    this.axisZoomOriginalDuration = 0;
    this.axisZoomOriginalYMin = 0;
    this.axisZoomOriginalYMax = 0;
    this.axisZoomStartDataValue = 0;
    this.axisZoomStartMouseRatio = 0;

    this.onAutoFitChange = () => {};

    // Flag để kiểm tra xem có đang tương tác với chart không
    this.isInteracting = false;

    // Lưu vị trí các button legend để xử lý click
    this.legendButtons = [];

    // Lưu trạng thái click để phân biệt click và drag
    this.mouseDownX = 0;
    this.mouseDownY = 0;
    this.isDragging = false;
  }

  // ==================== PUBLIC ====================
  init(canvas) {
    if (!canvas) return;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.setupEvents();

    // Bật AutoFit mặc định
    this.setAutoFit(true);
  }

  start() {
    this.isRunning = true;
    this.clear();
    this.unfreeze();
    this.setAutoFit(true);
    this.autoRender();
  }

  stop() {
    this.isRunning = false;
    this.freezeCurrentView();
  }

  /**
   * Freeze viewport hiện tại để giữ đồ thị đứng yên khi có dữ liệu mới đến,
   * nhưng vẫn cho phép cập nhật dữ liệu vào buffer
   */
  freezeCurrentView() {
    const baseTime = this.getBaseTime();
    const frozenAt = baseTime + this.viewOffsetMs;
    this.isPaused = true;
    this.freezeTime = frozenAt;
    this.requestRedraw();
  }

  /**
   * Set chart to unfreeze state, chart will auto scroll with new data comming
   */
  unfreeze() {
    this.isPaused = false;
    this.freezeTime = null;
    this.viewOffsetMs = 0;
    this.requestRedraw();
  }

  /**
   *  Clear all data points in chart and reset view to current time
   */
  clear() {
    this.dataPoints = {};
    this.buffer = [];
    this.channelMapping = {};
    this.nextChannelIndex = 1;
    this.channelVisibility = {};
    this.legendButtons = [];
    this.freezeTime = performance.now();
    this.requestRedraw();
  }

  /**
   * Fit the view to display all data currently available on the chart
   */
  zoomToFitData() {
    const bounds = this.getDataBounds();
    if (!bounds) {
      // Nếu không có dữ liệu, giữ nguyên view
      return;
    }

    // Đặt viewOffset để nhìn thấy dữ liệu mới nhất (cuối cùng)
    const baseTime = this.getBaseTime();
    this.viewOffsetMs = bounds.maxTime - baseTime;

    // Scale trục Y theo min/max của toàn bộ dữ liệu
    if (bounds.maxValue !== bounds.minValue) {
      // Nếu có range, scale chính xác
      const padding = (bounds.maxValue - bounds.minValue) * 0.1; // Thêm 10% padding
      this.yMin = bounds.minValue - padding;
      this.yMax = bounds.maxValue + padding;
    } else {
      // Nếu chỉ có 1 giá trị, tạo khoảng nhỏ xung quanh
      this.yMin = bounds.minValue - 1;
      this.yMax = bounds.maxValue + 1;
    }
    this.requestRedraw();
  }

  /**
   * Set AutoFit mode
   * @param {boolean} isValue - true to enable AutoFit, false to disable
   */
  setAutoFit(isValue) {
    this.isAutoFit = isValue;
    if (isValue) {
      // Nếu bật AutoFit, tự động fit dữ liệu
      this.zoomToFitData();
      // Reset trạng thái tương tác
      this.isInteracting = false;
    } else {
      // Nếu tắt AutoFit, đánh dấu đang tương tác
      this.isInteracting = true;
    }
    this.onAutoFitChange(this.isAutoFit);
  }

  /**
   * Get current AutoFit status
   * @returns {boolean} - true if AutoFit is enabled
   */
  getAutoFit() {
    return this.isAutoFit;
  }

  /**
   * Toggle AutoFit mode
   */
  toggleAutoFit() {
    this.setAutoFit(!this.isAutoFit);
  }

  /**
   * Adds a batch of samples to the chart buffer for a specific channel.
   * This buffer will be used to render automatically by an internal timer inside "chartMangager"
   * If the channel already exists in the buffer, the new points are appended.
   * Otherwise, a new channel entry is created.
   *
   * @param {number[]} samples Array of sample values.
   * @param {number} sampleIntervalSec Time interval between consecutive samples (seconds).
   * @param {number} baseTimestamp Timestamp of the first sample.
   * @param {string} [channel="ch1"] Target channel name.
   * @returns {void}
   */
  addChartBuffer(samples, sampleIntervalSec, baseTimestamp, channel = "ch1") {
    const dataPoints = [];
    for (let i = 0; i < samples.length; i++) {
      dataPoints.push({ value: samples[i], timestamp: baseTimestamp + i * sampleIntervalSec });
    }
    if (dataPoints.length === 0) return;
    const idx = this.buffer.findIndex((item) => item.channel === channel);
    if (idx >= 0) {
      // Append dữ liệu vào channel đã có
      this.buffer[idx].dataPoints.push(...dataPoints);
    } else {
      // Tạo channel mới
      this.buffer.push({ channel, dataPoints });
    }
  }

  /**
   * Set new chart labels
   */
  setLabels(...labels) {
    if (labels.length === 1 && Array.isArray(labels[0])) {
      this.customLabels = labels[0];
    } else {
      this.customLabels = labels;
    }

    const sortedChannels = Object.keys(this.dataPoints).sort();
    sortedChannels.forEach((ch, index) => {
      if (this.channelVisibility[ch] === undefined) {
        this.channelVisibility[ch] = true;
      }
    });

    this.requestRedraw();
  }

  // ==================== PRIVATE ====================
  /**
   * Start a timer that used to render the chart
   */
  autoRender() {
    if (this.chartTimer !== null) return;
    this.chartTimer = setInterval(() => {
      let needRedraw = false;
      for (const item of this.buffer) {
        if (!item.dataPoints || item.dataPoints.length === 0) {
          continue;
        }

        const originalChannel = item.channel;
        // Check if originalChannel is mapped to a display channel (ch1, ch2, ch3...), if not we create a new mapping
        let mappedChannel = this.channelMapping[originalChannel];
        if (!mappedChannel) {
          mappedChannel = `ch${this.nextChannelIndex}`;
          this.channelMapping[originalChannel] = mappedChannel;
          this.nextChannelIndex++;
          this.dataPoints[mappedChannel] = [];
          this.channelVisibility[mappedChannel] = true;
        }

        const target = this.dataPoints[mappedChannel];

        // Check if buffer render chart is overload we remove some old data points
        let count = 0;
        let now = performance.now();
        while (count < target.length && target[count].timestamp <= now - this.MAX_DURATION_VIEW_IN_CHART) {
          count++;
        }
        if (count > 0) {
          target.splice(0, count);
        }

        // Transfer data from buffer to Chart
        count = 0;
        while (count < item.dataPoints.length && item.dataPoints[count].timestamp <= now) {
          count++;
        }
        if (count === 0) continue;

        target.push(...item.dataPoints.splice(0, count));

        needRedraw = true;
      }
      if (needRedraw && !this.isPaused) {
        this.requestRedraw();
        // Nếu đang ở chế độ AutoFit, tự động fit dữ liệu
        if (this.isAutoFit) {
          this.zoomToFitData();
        }
      }
      if (!this.isRunning) {
        if (this.chartTimer) {
          clearInterval(this.chartTimer);
          this.chartTimer = null;
        }
        return;
      }
    }, this.TIME_RENDER_CHART_MS);
  }

  setupEvents() {
    window.addEventListener("resize", () => this.resize());
    this.resize();

    this.canvas.addEventListener("mousemove", (e) => this.handleMouseMove(e));
    this.canvas.addEventListener("mousedown", (e) => this.handleMouseDown(e));
    this.canvas.addEventListener("mouseup", (e) => this.handleMouseUp(e));
    this.canvas.addEventListener("click", (e) => this.handleCanvasClick(e));

    // Ngăn context menu mặc định khi click chuột phải trên canvas
    this.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      return false;
    });

    window.addEventListener("mouseup", () => {
      // Kết thúc mọi chế độ drag
      this.dragMode = null;
    });
  }

  handleMouseUp(e) {
    this.isDragging = false;
  }

  clampViewDuration(durationMs) {
    return Math.max(this.MIN_VIEW_DURATION_MS, Math.min(this.MAX_VIEW_DURATION_MS, durationMs));
  }

  /**
   * Get the reference timestamp used for rendering the chart
   *
   * This function determines the "current time" on the chart's time axis:
   *
   * - **Normal mode (not paused):**
   *   Returns the actual current time (performance.now()), allowing the chart
   *   to auto-scroll and display new incoming data in real-time.
   *
   * - **Paused mode (frozen):**
   *   Returns the frozen timestamp (freezeTime), keeping the chart static at
   *   a specific moment. Users can analyze historical data in detail without
   *   being pushed forward by new data.
   */
  getBaseTime() {
    if (this.isPaused && this.freezeTime !== null) {
      return this.freezeTime;
    }
    if (Object.keys(this.dataPoints).length === 0) {
      return this.freezeTime;
    }
    return performance.now();
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
    const sortedChannels = Object.keys(this.dataPoints).sort();
    let minTime = Infinity;
    let maxTime = -Infinity;
    let minValue = Infinity;
    let maxValue = -Infinity;
    let hasData = false;

    sortedChannels.forEach((channel) => {
      if (!this.getChannelVisibility(channel)) {
        return;
      }

      const points = this.dataPoints[channel];
      if (!Array.isArray(points) || points.length === 0) return;

      points.forEach((point) => {
        const timestamp = typeof point === "object" && point !== null ? point.timestamp : null;
        const value = typeof point === "object" && point !== null ? point.value : point;

        if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
          minTime = Math.min(minTime, timestamp);
          maxTime = Math.max(maxTime, timestamp);
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

  getX(timestamp, minTime, activeWidth, dpr) {
    return this.margins.left * dpr + ((timestamp - minTime) / this.VIEW_DURATION_MS) * activeWidth;
  }

  getY(val, activeHeight, height, dpr) {
    const range = this.yMax - this.yMin;
    const ratio = (val - this.yMin) / range;
    return height - this.margins.bottom * dpr - ratio * activeHeight;
  }

  /**
   * Get legend button at specific position
   * @param {number} x - X coordinate in canvas pixel space
   * @param {number} y - Y coordinate in canvas pixel space
   * @returns {Object|null} - The legend button object or null if not found
   */
  getLegendButtonAt(x, y) {
    for (const button of this.legendButtons) {
      if (x >= button.x && x <= button.x + button.width && y >= button.y && y <= button.y + button.height) {
        return button;
      }
    }
    return null;
  }

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

    // === XỬ LÝ PAN X (chuột phải + kéo ngang) ===
    if (this.dragMode === "pan-x") {
      const deltaX = e.clientX - this.startPanX;
      const activeWidth = this.canvas.width / dpr - this.margins.left - this.margins.right;
      this.viewOffsetMs = Math.min(0, this.originalViewOffsetMs - deltaX * (this.VIEW_DURATION_MS / activeWidth));
      this.hoverPoint = null;
      this.requestRedraw();
      return;
    }

    // === XỬ LÝ PAN Y (chuột phải + kéo dọc) ===
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

    // === XỬ LÝ ZOOM X (chuột trái trên trục X) ===
    if (this.dragMode === "zoom-x") {
      const deltaX = e.clientX - this.axisZoomStartX;
      const sensitivity = 0.005;
      let factor = 1 + deltaX * sensitivity;
      factor = Math.max(0.2, Math.min(5, factor));
      let newDuration = this.axisZoomOriginalDuration * factor;
      newDuration = this.clampViewDuration(newDuration);

      const baseTime = this.getBaseTime();
      const targetTimestamp = this.axisZoomStartDataValue;
      const ratio = this.axisZoomStartMouseRatio;
      const newMinTime = targetTimestamp - ratio * newDuration;
      const newNow = newMinTime + newDuration;
      this.viewOffsetMs = newNow - baseTime;
      this.VIEW_DURATION_MS = newDuration;
      this.requestRedraw();
      return;
    }

    // === XỬ LÝ ZOOM Y (chuột trái trên trục Y) ===
    if (this.dragMode === "zoom-y") {
      const deltaY = this.axisZoomStartY - e.clientY;
      const sensitivity = 0.005;
      let factor = 1 - deltaY * sensitivity;
      factor = Math.max(0.2, Math.min(5, factor));
      const originalRange = this.axisZoomOriginalYMax - this.axisZoomOriginalYMin;
      let newRange = originalRange * factor;
      if (newRange < 1e-9) newRange = 1e-9;

      const targetValue = this.axisZoomStartDataValue;
      const ratio = (targetValue - this.axisZoomOriginalYMin) / originalRange;
      const newYMin = targetValue - ratio * newRange;
      const newYMax = newYMin + newRange;

      if (newYMin < newYMax) {
        this.yMin = newYMin;
        this.yMax = newYMax;
      }
      this.requestRedraw();
      return;
    }

    // === HOVER THÔNG THƯỜNG (không drag) ===
    this.mouseX = (e.clientX - rect.left) * dpr;
    this.updateHoverPoint(dpr);
    this.requestRedraw();
    this.updateCursorStyle(e, dpr);
  }

  updateCursorStyle(e, dpr) {
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * dpr;
    const mouseY = (e.clientY - rect.top) * dpr;

    // Kiểm tra legend button trước
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

    // Khi click vào chart, tắt AutoFit nếu đang bật
    if (this.isAutoFit) {
      this.setAutoFit(false);
    }

    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const clickX = (e.clientX - rect.left) * dpr;
    const clickY = (e.clientY - rect.top) * dpr;
    const isRightClick = e.button === 2;
    const isLeftClick = e.button === 0;

    // Xác định vùng tương tác
    const onXAxis =
      clickY >= this.canvas.height - this.margins.bottom * dpr &&
      clickX >= this.margins.left * dpr &&
      clickX <= this.canvas.width - this.margins.right * dpr;
    const onYAxis =
      clickX <= this.margins.left * dpr &&
      clickY >= this.margins.top * dpr &&
      clickY <= this.canvas.height - this.margins.bottom * dpr;
    const onPlotArea = this.isInsidePlotArea(clickX, clickY, dpr);

    // ========== CHUỘT PHẢI: PAN (Di chuyển đồ thị) ==========
    if (isRightClick && onPlotArea) {
      e.preventDefault();

      // Lưu trạng thái ban đầu
      this.startPanX = e.clientX;
      this.startPanY = e.clientY;
      this.originalViewOffsetMs = this.viewOffsetMs;
      this.originalYMin = this.yMin;
      this.originalYMax = this.yMax;

      let directionDetermined = false;
      let moveListener = null;
      let upListener = null;

      // Handler để xác định hướng drag sau khi chuột bắt đầu di chuyển
      const determineDirection = (moveEvent) => {
        if (directionDetermined) return;

        const deltaX = moveEvent.clientX - this.startPanX;
        const deltaY = moveEvent.clientY - this.startPanY;

        // Nếu di chuyển quá ngưỡng 5px, chốt chế độ
        if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
          directionDetermined = true;
          this.dragMode = Math.abs(deltaX) > Math.abs(deltaY) ? "pan-x" : "pan-y";

          // Xóa listener xác định hướng sau khi đã chốt
          if (moveListener) {
            window.removeEventListener("mousemove", moveListener);
          }
        }
      };

      const onMouseUp = () => {
        // Cleanup tất cả listeners
        if (moveListener) {
          window.removeEventListener("mousemove", moveListener);
        }
        if (upListener) {
          window.removeEventListener("mouseup", upListener);
        }

        // Nếu không có hướng được xác định (click không kéo), không thực hiện pan
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

    // ========== CHUỘT TRÁI: ZOOM TRÊN TRỤC X ==========
    if (isLeftClick && onXAxis) {
      e.preventDefault();
      this.dragMode = "zoom-x";
      this.axisZoomStartX = e.clientX;
      this.axisZoomStartY = e.clientY;
      this.axisZoomOriginalDuration = this.VIEW_DURATION_MS;

      const baseTime = this.getBaseTime();
      const now = baseTime + this.viewOffsetMs;
      const minTime = now - this.VIEW_DURATION_MS;
      const activeWidth = this.getActiveWidthDpr(dpr);
      const relativeX = Math.max(0, Math.min(activeWidth, clickX - this.margins.left * dpr));
      const ratio = relativeX / activeWidth;

      this.axisZoomStartDataValue = minTime + ratio * this.VIEW_DURATION_MS;
      this.axisZoomStartMouseRatio = ratio;
      return;
    }

    // ========== CHUỘT TRÁI: ZOOM TRÊN TRỤC Y ==========
    if (isLeftClick && onYAxis) {
      e.preventDefault();
      this.dragMode = "zoom-y";
      this.axisZoomStartX = e.clientX;
      this.axisZoomStartY = e.clientY;
      this.axisZoomOriginalYMin = this.yMin;
      this.axisZoomOriginalYMax = this.yMax;

      const activeH = this.getActiveHeightDpr(dpr);
      const relativeY = Math.max(0, Math.min(activeH, clickY - this.margins.top * dpr));
      const ratio = 1 - relativeY / activeH;

      this.axisZoomStartDataValue = this.yMin + ratio * (this.yMax - this.yMin);
      return;
    }
  }

  handleCanvasClick(e) {
    // Skipping click because dragging
    if (this.isDragging) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Tính tọa độ click trong canvas coordinate (pixel của canvas)
    const clickX = (e.clientX - rect.left) * dpr;
    const clickY = (e.clientY - rect.top) * dpr;

    // Tìm button được click
    const clickedButton = this.getLegendButtonAt(clickX, clickY);
    if (clickedButton) {
      // Toggle visibility của channel này
      const channel = clickedButton.channel;
      const currentVisibility = this.getChannelVisibility(channel);
      this.channelVisibility[channel] = !currentVisibility;

      this.setAutoFit(true);
      e.stopPropagation();
    }
  }

  updateHoverPoint(dpr) {
    const baseTime = this.getBaseTime();
    const now = baseTime + this.viewOffsetMs;
    const minTime = now - this.VIEW_DURATION_MS;
    const activeWidth = this.getActiveWidthDpr(dpr);

    if (this.mouseX >= this.margins.left * dpr && this.mouseX <= this.canvas.width - this.margins.right * dpr) {
      const targetTime = minTime + ((this.mouseX - this.margins.left * dpr) / activeWidth) * this.VIEW_DURATION_MS;
      const pointsAtTime = [];

      for (const channel in this.dataPoints) {
        if (!this.getChannelVisibility(channel)) {
          continue;
        }

        const points = this.dataPoints[channel];
        let closestPoint = null;
        let minDiff = Infinity;

        for (let i = points.length - 1; i >= 0; i--) {
          const p = points[i];
          if (p.timestamp < minTime - 500) break;
          const diff = Math.abs(p.timestamp - targetTime);
          if (diff < minDiff) {
            minDiff = diff;
            closestPoint = p;
          } else if (p.timestamp < targetTime) break;
        }
        if (closestPoint && minDiff < 500) {
          pointsAtTime.push({ ...closestPoint, channel });
        }
      }
      this.hoverPoint = pointsAtTime.length > 0 ? { timestamp: targetTime, points: pointsAtTime } : null;
    } else {
      this.hoverPoint = null;
    }
  }

  getChannelVisibility(channel) {
    return this.channelVisibility[channel] !== undefined ? this.channelVisibility[channel] : true;
  }

  draw() {
    if (!this.ctx) return;

    const { width, height } = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    this.ctx.clearRect(0, 0, width, height);

    const baseTime = this.getBaseTime();
    const now = baseTime + this.viewOffsetMs;
    const minTime = now - this.VIEW_DURATION_MS;
    const maxTime = now;
    const activeW = width - (this.margins.left + this.margins.right) * dpr;
    const activeH = height - (this.margins.top + this.margins.bottom) * dpr;

    // Grid Y
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

    // Grid X
    const minRT = Utils.bootTime + minTime;
    const maxRT = Utils.bootTime + maxTime;
    const firstSec = Math.ceil(minRT / 1000) * 1000;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "top";

    for (let t = firstSec; t <= maxRT; t += 1000) {
      const x = this.getX(t - Utils.bootTime, minTime, activeW, dpr);
      if (x >= this.margins.left * dpr && x <= width - this.margins.right * dpr) {
        this.ctx.strokeStyle = "rgba(30, 41, 59, 0.4)";
        this.ctx.beginPath();
        this.ctx.moveTo(x, this.margins.top * dpr);
        this.ctx.lineTo(x, height - this.margins.bottom * dpr);
        this.ctx.stroke();
        this.ctx.fillStyle = "rgba(148, 163, 184, 0.8)";
        this.ctx.font = `${9 * dpr}px Inter`;
        this.ctx.fillText(Utils.formatRealTime(new Date(t)), x, height - (this.margins.bottom - 8) * dpr);
      }
    }

    // Axis lines
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

    // Waveform - clip area
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(this.margins.left * dpr, this.margins.top * dpr, activeW, activeH);
    this.ctx.clip();

    const palette = [
      { color: "#3b82f6", fill: "rgba(59,130,246,0.15)" }, // Blue
      { color: "#ef4444", fill: "rgba(239,68,68,0.15)" }, // Red
      { color: "#22c55e", fill: "rgba(34,197,94,0.15)" }, // Green
      { color: "#eab308", fill: "rgba(234,179,8,0.15)" }, // Yellow
      { color: "#a855f7", fill: "rgba(168,85,247,0.15)" }, // Purple
      { color: "#06b6d4", fill: "rgba(6,182,212,0.15)" }, // Cyan
      { color: "#f97316", fill: "rgba(249,115,22,0.15)" }, // Orange
      { color: "#84cc16", fill: "rgba(132,204,22,0.15)" }, // Lime
      { color: "#14b8a6", fill: "rgba(20,184,166,0.15)" }, // Teal
      { color: "#4B5563", fill: "rgba(75,85,99,0.15)" }, // Slate
    ];

    let hasData = false;
    const sortedChannels = Object.keys(this.dataPoints).sort();

    sortedChannels.forEach((channel, idx) => {
      if (!this.getChannelVisibility(channel)) {
        return;
      }

      const points = this.dataPoints[channel];
      const config = palette[idx % palette.length];
      let firstIdx = -1;
      let lastIdx = -1;

      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p.timestamp >= minTime && p.timestamp <= maxTime) {
          if (firstIdx === -1) firstIdx = i;
          lastIdx = i;
        }
      }

      if (firstIdx !== -1 && lastIdx > firstIdx) {
        hasData = true;

        this.ctx.beginPath();
        this.ctx.moveTo(
          this.getX(points[firstIdx].timestamp, minTime, activeW, dpr),
          this.getY(this.yMin, activeH, height, dpr),
        );
        for (let i = firstIdx; i <= lastIdx; i++) {
          this.ctx.lineTo(
            this.getX(points[i].timestamp, minTime, activeW, dpr),
            this.getY(points[i].value, activeH, height, dpr),
          );
        }
        this.ctx.lineTo(
          this.getX(points[lastIdx].timestamp, minTime, activeW, dpr),
          this.getY(this.yMin, activeH, height, dpr),
        );

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

        this.ctx.beginPath();
        this.ctx.moveTo(
          this.getX(points[firstIdx].timestamp, minTime, activeW, dpr),
          this.getY(points[firstIdx].value, activeH, height, dpr),
        );
        for (let i = firstIdx + 1; i <= lastIdx; i++) {
          this.ctx.lineTo(
            this.getX(points[i].timestamp, minTime, activeW, dpr),
            this.getY(points[i].value, activeH, height, dpr),
          );
        }

        this.ctx.strokeStyle = config.color;
        this.ctx.lineWidth = 2.5 * dpr;
        this.ctx.lineCap = "round";
        this.ctx.lineJoin = "round";
        this.ctx.shadowColor = config.color + "66";
        this.ctx.shadowBlur = 4 * dpr;
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;
      }
    });

    if (!hasData) {
      this.ctx.fillStyle = "rgba(148, 163, 184, 0.4)";
      this.ctx.font = `${12 * dpr}px Inter`;
      this.ctx.textAlign = "center";
      this.ctx.fillText("Press 'Start' to activate plot graphs", (this.margins.left * dpr + width) / 2, height / 2);
    }
    this.ctx.restore();

    // Legend - Toggle buttons
    this.ctx.save();
    this.ctx.textBaseline = "middle";
    this.ctx.textAlign = "left";
    let legendX = (this.margins.left + 10) * dpr;
    const legendY = (this.margins.top + 15) * dpr;

    // Reset legend buttons - LƯU Ý: lưu trực tiếp trong canvas coordinate (đã nhân DPR)
    this.legendButtons = [];

    sortedChannels.forEach((channel, i) => {
      const config = palette[i % palette.length];
      const isVisible = this.getChannelVisibility(channel);
      const label = (this.customLabels[i] || `Sensor ${String.fromCharCode(65 + (i % 26))}`).toUpperCase();

      this.ctx.font = `bold ${10 * dpr}px Inter`;
      const textWidth = this.ctx.measureText(label).width;
      const buttonWidth = textWidth + 28 * dpr;
      const buttonHeight = 22 * dpr;
      const buttonX = legendX - 2 * dpr;
      const buttonY = legendY - buttonHeight / 2;

      // Lưu button với tọa độ canvas (đã nhân DPR)
      this.legendButtons.push({
        x: buttonX,
        y: buttonY,
        width: buttonWidth,
        height: buttonHeight,
        channel: channel,
      });

      this.ctx.beginPath();
      this.ctx.roundRect(buttonX, buttonY, buttonWidth, buttonHeight, 4 * dpr);

      if (isVisible) {
        this.ctx.fillStyle = config.color + "33";
      } else {
        this.ctx.fillStyle = "rgba(51, 65, 85, 0.6)";
      }
      this.ctx.fill();

      this.ctx.strokeStyle = isVisible ? config.color : "rgba(100, 116, 139, 0.5)";
      this.ctx.lineWidth = 1.5 * dpr;
      this.ctx.stroke();

      this.ctx.beginPath();
      this.ctx.arc(legendX + 6 * dpr, legendY, 4 * dpr, 0, Math.PI * 2);
      this.ctx.fillStyle = isVisible ? config.color : "rgba(100, 116, 139, 0.4)";
      this.ctx.fill();

      if (isVisible) {
        this.ctx.strokeStyle = "#ffffff";
        this.ctx.lineWidth = 1 * dpr;
        this.ctx.stroke();
      }

      this.ctx.fillStyle = isVisible ? "rgba(226, 232, 240, 0.9)" : "rgba(148, 163, 184, 0.5)";
      this.ctx.font = `bold ${10 * dpr}px Inter`;
      this.ctx.fillText(label, legendX + 14 * dpr, legendY);

      legendX += buttonWidth + 12 * dpr;
    });
    this.ctx.restore();

    // Tooltip
    // Check if not have data points in chart, we skip draw tooltiop to avoid error when hover without data
    if (Object.keys(this.dataPoints).length === 0) {
      return;
    }
    if (this.hoverPoint && this.hoverPoint.points && this.mouseX !== null) {
      const hx = this.getX(this.hoverPoint.timestamp, minTime, activeW, dpr);

      if (hx >= this.margins.left * dpr && hx <= width - this.margins.right * dpr) {
        this.ctx.strokeStyle = "rgba(226, 232, 240, 0.3)";
        this.ctx.lineWidth = 1 * dpr;
        this.ctx.setLineDash([4 * dpr, 4 * dpr]);
        this.ctx.beginPath();
        this.ctx.moveTo(hx, this.margins.top * dpr);
        this.ctx.lineTo(hx, height - this.margins.bottom * dpr);
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        this.hoverPoint.points.forEach((p) => {
          const hy = this.getY(p.value, activeH, height, dpr);
          const channelIdx = sortedChannels.indexOf(p.channel);
          const config = palette[channelIdx % palette.length];
          this.ctx.beginPath();
          this.ctx.arc(hx, hy, 5 * dpr, 0, Math.PI * 2);
          this.ctx.fillStyle = config.color;
          this.ctx.strokeStyle = "#ffffff";
          this.ctx.lineWidth = 1.5 * dpr;
          this.ctx.fill();
          this.ctx.stroke();
        });

        const lineH = 18 * dpr;
        const tw = 160 * dpr;
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

        this.ctx.textAlign = "left";
        this.ctx.textBaseline = "top";

        this.ctx.fillStyle = "rgba(148, 163, 184, 0.9)";
        this.ctx.font = `${9 * dpr}px Inter`;
        const pointDate = Utils.getRealTime(this.hoverPoint.timestamp);
        this.ctx.fillText(`Time: ${Utils.formatRealTimeWithMs(pointDate)}`, tx + 10 * dpr, ty + 10 * dpr);

        this.hoverPoint.points.forEach((p, i) => {
          const channelIdx = sortedChannels.indexOf(p.channel);
          const config = palette[channelIdx % palette.length];
          const label = this.customLabels[channelIdx] || `Sensor ${String.fromCharCode(65 + (channelIdx % 26))}`;

          this.ctx.textAlign = "left";
          this.ctx.fillStyle = config.color;
          this.ctx.font = `bold ${10 * dpr}px Inter`;
          this.ctx.fillText(`${label}:`, tx + 10 * dpr, ty + (26 + i * lineH) * dpr);

          this.ctx.fillStyle = "#ffffff";
          this.ctx.textAlign = "right";
          this.ctx.fillText(p.value.toFixed(1), tx + tw - 10 * dpr, ty + (26 + i * lineH) * dpr);
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
  addChartBuffer: (samples, sampleIntervalSec, baseTimestamp, channel) =>
    CHART.addChartBuffer(samples, sampleIntervalSec, baseTimestamp, channel),
  setLabels: (...labels) => CHART.setLabels(...labels),
  onAutoFitChange: (fn) => (CHART.onAutoFitChange = fn),
};
