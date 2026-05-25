// ============================================================
// ChartManager – vẽ đồ thị PPG lên Canvas, quản lý hover & pan
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
    this.canvas = null;
    this.ctx = null;
    this.dataPoints = {};
    this.customLabels = []; // Khởi tạo mảng nhãn tùy chỉnh
    this.margins = { left: 70, right: 20, top: 30, bottom: 40 };
    this.viewDurationMs = 10000;
    this.viewOffsetMs = 0;
    this.hoverPoint = null;
    this.mouseX = null;
    this.isPanning = false;
    this.startPanX = 0;
    this.originalViewOffsetMs = 0;

    this.isSimRunning = false;
    this.lastSimTime = null;
    this.drawPending = false;
    this.isPaused = false;
    this.freezeTime = null;
  }

  init(canvas) {
    if (!canvas) return;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.setupEvents();
  }

  setLabels(...labels) {
    if (labels.length === 1 && Array.isArray(labels[0])) {
      this.customLabels = labels[0];
    } else {
      this.customLabels = labels;
    }
    this.requestRedraw();
  }

  setupEvents() {
    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.canvas.addEventListener("mousemove", (e) => this.handleMouseMove(e));
    this.canvas.addEventListener("mousedown", (e) => this.handleMouseDown(e));
    this.canvas.addEventListener("mouseleave", () => {
      this.hoverPoint = null;
      this.mouseX = null;
      this.requestRedraw();
    });
    window.addEventListener("mouseup", () => (this.isPanning = false));
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;
    this.requestRedraw();
  }

  // Thêm phương thức nhận một danh sách các điểm dữ liệu
  addDataPoints(samples, isRunning = null, lastSimTime = null, channel = "ch1") {
    if (isRunning !== null) this.isSimRunning = isRunning;
    if (lastSimTime !== null) this.lastSimTime = lastSimTime;

    // Tự động khởi tạo mảng nếu channel chưa tồn tại
    if (!this.dataPoints[channel]) this.dataPoints[channel] = [];
    const target = this.dataPoints[channel];

    for (const s of samples) {
      target.push({ value: s.value, timestamp: s.timestamp });
    }

    const limit = performance.now() - 30000;
    while (target.length > 0 && target[0].timestamp < limit) {
      target.shift();
    }
    this.requestRedraw();
  }

  requestRedraw() {
    if (this.drawPending) return;
    this.drawPending = true;
    requestAnimationFrame(() => {
      this.draw(this.isSimRunning, this.lastSimTime);
      this.drawPending = false;
    });
  }

  getX(timestamp, minTime, activeWidth, dpr) {
    return this.margins.left * dpr + ((timestamp - minTime) / this.viewDurationMs) * activeWidth;
  }

  getY(val, activeHeight, height, dpr) {
    return height - this.margins.bottom * dpr - (val / 1000) * activeHeight;
  }

  handleMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (this.isPanning) {
      const deltaX = e.clientX - this.startPanX;
      const activeWidth = this.canvas.width / dpr - this.margins.left - this.margins.right;
      this.viewOffsetMs = Math.min(0, this.originalViewOffsetMs - deltaX * (this.viewDurationMs / activeWidth));
      this.hoverPoint = null;
      this.requestRedraw();
    } else {
      this.mouseX = (e.clientX - rect.left) * dpr;
      this.updateHoverPoint(dpr);
      this.requestRedraw();
    }
  }

  handleMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const clickX = (e.clientX - rect.left) * dpr;
    if (clickX >= this.margins.left * dpr) {
      this.isPanning = true;
      this.startPanX = e.clientX;
      this.originalViewOffsetMs = this.viewOffsetMs;
      if (this.onStartPan) this.onStartPan();
    }
  }

  updateHoverPoint(dpr) {
    let baseTime;
    if (this.isPaused && this.freezeTime !== null) {
      baseTime = this.freezeTime;
    } else {
      baseTime = this.isSimRunning ? performance.now() : this.lastSimTime || 10000;
    }
    const now = baseTime + this.viewOffsetMs;
    const minTime = now - this.viewDurationMs;
    const maxTime = now;
    const activeWidth = this.canvas.width - (this.margins.left + this.margins.right) * dpr;
    if (this.mouseX >= this.margins.left * dpr && this.mouseX <= this.canvas.width - this.margins.right * dpr) {
      const targetTime = minTime + ((this.mouseX - this.margins.left * dpr) / activeWidth) * this.viewDurationMs;
      const pointsAtTime = [];

      for (const channel in this.dataPoints) {
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
    } else this.hoverPoint = null;
  }

  draw(isRunning, lastSimTime) {
    if (!this.ctx) return;

    this.isSimRunning = isRunning;
    this.lastSimTime = lastSimTime;
    const { width, height } = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    this.ctx.clearRect(0, 0, width, height);
    let baseTime;
    if (this.isPaused && this.freezeTime !== null) {
      baseTime = this.freezeTime;
    } else {
      baseTime = isRunning ? performance.now() : lastSimTime || 10000;
    }
    const now = baseTime + this.viewOffsetMs;
    const minTime = now - this.viewDurationMs;
    const maxTime = now;
    const activeW = width - (this.margins.left + this.margins.right) * dpr;
    const activeH = height - (this.margins.top + this.margins.bottom) * dpr;

    // Grid Y
    this.ctx.lineWidth = 1 * dpr;
    for (let v = 0; v <= 1000; v += 200) {
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
      this.ctx.fillText(`${v}`, (this.margins.left - 10) * dpr, y);
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

    // Axis
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

    // Waveform
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(this.margins.left * dpr, this.margins.top * dpr, activeW, activeH);
    this.ctx.clip();

    // Bảng màu tự động gán cho các kênh (Xanh, Đỏ, Lục, Cam, Tím...)
    const palette = [
      { color: "#3b82f6", fill: "rgba(59, 130, 246, 0.2)" },
      { color: "#ef4444", fill: "rgba(239, 68, 68, 0.2)" },
      { color: "#10b981", fill: "rgba(16, 185, 129, 0.2)" },
      { color: "#f59e0b", fill: "rgba(245, 158, 11, 0.2)" },
      { color: "#8b5cf6", fill: "rgba(139, 92, 246, 0.2)" },
    ];

    let hasData = false;
    const sortedChannels = Object.keys(this.dataPoints).sort();
    sortedChannels.forEach((channel, idx) => {
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
        // Vẽ vùng đổ màu (Fill)
        this.ctx.beginPath();
        this.ctx.moveTo(
          this.getX(points[firstIdx].timestamp, minTime, activeW, dpr),
          this.getY(0, activeH, height, dpr),
        );
        for (let i = firstIdx; i <= lastIdx; i++) {
          this.ctx.lineTo(
            this.getX(points[i].timestamp, minTime, activeW, dpr),
            this.getY(points[i].value, activeH, height, dpr),
          );
        }
        this.ctx.lineTo(
          this.getX(points[lastIdx].timestamp, minTime, activeW, dpr),
          this.getY(0, activeH, height, dpr),
        );

        const grad = this.ctx.createLinearGradient(
          0,
          this.getY(1000, activeH, height, dpr),
          0,
          this.getY(0, activeH, height, dpr),
        );
        grad.addColorStop(0, config.fill);
        grad.addColorStop(1, "rgba(0, 0, 0, 0)");
        this.ctx.fillStyle = grad;
        this.ctx.fill();

        // Vẽ đường tín hiệu (Stroke)
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

    if (!hasData && lastSimTime === null) {
      this.ctx.fillStyle = "rgba(148, 163, 184, 0.4)";
      this.ctx.font = `${12 * dpr}px Inter`;
      this.ctx.textAlign = "center";
      this.ctx.fillText("Press 'Start' to activate plot graphs", (this.margins.left * dpr + width) / 2, height / 2);
    }
    this.ctx.restore();

    // --- Vẽ Legend (Chú thích) ở góc Top Left ---
    this.ctx.save();
    this.ctx.textBaseline = "middle";
    this.ctx.textAlign = "left";
    let legendX = (this.margins.left + 10) * dpr;
    const legendY = (this.margins.top + 15) * dpr;

    sortedChannels.forEach((channel, i) => {
      const config = palette[i % palette.length];
      const label = (this.customLabels[i] || `Sensor ${String.fromCharCode(65 + (i % 26))}`).toUpperCase();

      this.ctx.font = `bold ${10 * dpr}px Inter`;
      const textWidth = this.ctx.measureText(label).width;

      // Vẽ chấm màu
      this.ctx.beginPath();
      this.ctx.arc(legendX + 4 * dpr, legendY, 3.5 * dpr, 0, Math.PI * 2);
      this.ctx.fillStyle = config.color;
      this.ctx.fill();

      // Vẽ nhãn văn bản
      this.ctx.fillStyle = "rgba(226, 232, 240, 0.9)";
      this.ctx.fillText(label, legendX + 14 * dpr, legendY);

      // Di chuyển vị trí X sang phải cho nhãn tiếp theo
      legendX += textWidth + 30 * dpr;
    });
    this.ctx.restore();

    // Tooltip
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

        const sortedChannels = Object.keys(this.dataPoints).sort();

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

  freezeAt(time) {
    this.isPaused = true;
    this.freezeTime = time;
    this.requestRedraw();
  }

  unfreeze() {
    this.isPaused = false;
    this.freezeTime = null;
    this.viewOffsetMs = 0;
    this.requestRedraw();
  }
}

export const CHART = new ChartManager();
