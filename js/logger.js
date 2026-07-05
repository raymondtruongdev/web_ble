class Logger {
  constructor() {
    this.terminalComponent = null;
  }

  //  Đăng ký DOM element của ô terminal từ UI
  registerTerminal(element) {
    this.terminalComponent = element;
  }

  //  Helper lấy thời gian hiện tại [HH:MM:SS]
  _formatTimestamp() {
    const now = new Date();
    return `[${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}]`;
  }

  /**
   * In log ra Terminal UI
   * @param {'info' | 'success' | 'warning' | 'error' | 'default'} type
   * @param {string} message
   */
  log(type = "info", message) {
    if (!this.terminalComponent) return;

    if (type === "warning" || type === "error") {
      console.warn(message);
    } else {
      console.log(message);
    }

    const logLine = document.createElement("div");
    const colorMap = {
      error: "#f85149",
      success: "#3fb950",
      warning: "#d29922",
      info: "#58a6ff",
      default: "#e2e8f0",
    };
    const timestampColor = "#8d949d";
    const time = this._formatTimestamp();
    const textColor = colorMap[type] || colorMap.default;

    const lines = String(message).split("\n");

    lines.forEach((line, index) => {
      const logLine = document.createElement("div");

      logLine.innerHTML = `
      <span
        style="
          color: ${timestampColor};
          display: inline-block;
          width: 80px;
          flex-shrink: 0;
        "
      >
        ${index === 0 ? time : ""}
      </span>
      <span
        style="
          color: ${textColor};
          white-space: pre;
        "
      ></span>
    `;

      if (logLine.lastElementChild) {
        logLine.lastElementChild.textContent = line;
      }

      this.terminalComponent.appendChild(logLine);
    });

    this.terminalComponent.scrollTop = this.terminalComponent.scrollHeight;
  }

  // Xóa sạch màn hình terminal
  clear() {
    if (this.terminalComponent) {
      this.terminalComponent.innerHTML = "";
    }
  }
}

export const logger = new Logger();
