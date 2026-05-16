class BLEManager {
  constructor() {
    /**
     * Callback to notify a message from BLE manager
     * @param {string} type - Type of the message (e.g., "info", "warning", "error")
     * @param {string} text - Message text to display
     */
    this.onMessageNotify = () => {};

       /**
     * Callback to update BLE connection status
     * @param {boolean} isConnected - state of the device connection
     * @param {string} deviceName - Name of the connected device
     * @param {string} deviceId - ID of the connected device
     */
    this.onStatusChange = () => {}; // Cần truyền: (isConnected, deviceName, deviceId)

    /**
     * Callback to notify when new data is received from the BLE device
     * @param {string} data - Message text to display
     */
    this.onDataReceived = () => {};

    // =============== Variables ===============
    this.device = null; // BluetoothDevice object
    this.server = null; // BluetoothRemoteGATTServer object
    this.service = null; // BluetoothRemoteGATTService object
    this.defaultWriteCharacteristic = null; // BluetoothRemoteGATTCharacteristic for writing
    this.defaultNotifyCharacteristic = null; // BluetoothRemoteGATTCharacteristic for notifications
    this.isConnected = false;

    this.boundDisconnectHandler = this.handleDisconnect.bind(this);
    this.boundNotifyHandler = this.handleData.bind(this);

    this.UUIDS = {
      SERVICE: "0000fff0-0000-1000-8000-00805f9b34fb",
      WRITE: "fff1",
      NOTIFY: "fff2",
    };

    this.CONFIG = {
      optionalServices: [
        "heart_rate",
        "battery_service",
        "device_information",
        "current_time",
        "0000ffe0-0000-1000-8000-00805f9b34fb", // Custom Service for testing
        "00001234-0000-1000-8000-00805f9b34fb", // Custom Service for testing
        "0000fff0-0000-1000-8000-00805f9b34fb", // T2D OS Service
      ],
    };
  }

  // =============== FUNCTIONS ==================

  // Update BLE connection status
  async updateConnectionStatus(status) {
    this.isConnected = status;
    this.onStatusChange(status, this.device.name || "Unknown Device", this.device.id);
  }

  // Connect to a BLE device and set up characteristics
  async connect() {
    try {
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: this.CONFIG.optionalServices,
      });

      this.device.removeEventListener("gattserverdisconnected", this.boundDisconnectHandler);
      this.device.addEventListener("gattserverdisconnected", this.boundDisconnectHandler);

      this.server = await this.device.gatt.connect();
      this.updateConnectionStatus(true);
      this.onMessageNotify("success", "BLE Connected UART ✅");
      

      if (this.device.name && this.device.name.includes("T2D OS")) {
        await this.autoSetup(this.server);
      }
    } catch (err) {
      this.onMessageNotify("error", `BLE Connection error: ${err.message || err}`);
    }
  }

  // Disconnect by user request
  async disconnect() {
    try {
      if (this.device?.gatt.connected) {
       await this.device.gatt.disconnect();
      
      }
    } catch (err) {
      this.onMessageNotify("error", `BLE Disconnect error: ${err.message || err}`);
    }
  }

  // This function is called when the device gets disconnected (either by user or unexpectedly)
  async handleDisconnect() {
    if (!this.isConnected) return;
    try {
      if (this.defaultNotifyCharacteristic) {
        this.defaultNotifyCharacteristic.removeEventListener("characteristicvaluechanged", this.boundNotifyHandler);
      }
    } catch (e) {
      console.error("Cleanup error: " + e.message);
    }
    this.service = null;
    this.defaultWriteCharacteristic = null;
    this.defaultNotifyCharacteristic = null;

    this.updateConnectionStatus(false);
    this.onMessageNotify("warning", "BLE is disconnected ❌");
  }

  handleData(event) {
    const res = this.decodeBleValue(event.target.value, this.UUIDS.NOTIFY);
    this.onDataReceived(res.string);
  }

  async autoSetup(gattServer) {
    try {
      this.service = await gattServer.getPrimaryService(this.UUIDS.SERVICE);
      const chars = await this.service.getCharacteristics();
      this.defaultWriteCharacteristic = chars.find((c) => c.uuid.includes(this.UUIDS.WRITE));
      this.defaultNotifyCharacteristic = chars.find((c) => c.uuid.includes(this.UUIDS.NOTIFY));

      if (this.defaultNotifyCharacteristic) {
        await this.defaultNotifyCharacteristic.startNotifications();
        this.defaultNotifyCharacteristic.removeEventListener("characteristicvaluechanged", this.boundNotifyHandler);
        this.defaultNotifyCharacteristic.addEventListener("characteristicvaluechanged", this.boundNotifyHandler);
      }
    } catch (e) {
      this.onMessageNotify("error", "[T2D] No compatible T2D service found" + e.message);
    }
  }

  decodeBleValue(value, uuid = "") {
    let hexArr = [];
    for (let i = 0; i < value.byteLength; i++) {
      hexArr.push(value.getUint8(i).toString(16).padStart(2, "0").toUpperCase());
    }
    const shortUuid = uuid.substring(4, 8).toLowerCase();
    let bpmValue = null;
    let interpreted = "";

    if (shortUuid === "2a37") {
      let flags = value.getUint8(0);
      bpmValue = flags & 0x01 ? value.getUint16(1, true) : value.getUint8(1);
      interpreted = ` [BPM: ${bpmValue}]`;
    }

    const decoder = new TextDecoder("utf-8");
    let textVal = "";
    try {
      textVal = decoder.decode(value).replace(/[\x00-\x1F\x7F-\x9F]/g, "");
    } catch (e) {
      textVal = "(binary)";
    }

    return { hex: hexArr.join(" "), string: textVal, interpreted, bpm: bpmValue };
  }

  async sendCommand(str_cmd) {
    if (!this.defaultWriteCharacteristic) throw new Error("[T2D] Không có quyền ghi hoặc chưa kết nối FFF1");

    const payload = new TextEncoder().encode(str_cmd);
    const frame = new Uint8Array(1 + 2 + payload.length);
    frame[0] = 0x01;
    frame[1] = payload.length & 0xff;
    frame[2] = (payload.length >> 8) & 0xff;
    frame.set(payload, 3);

    const method = this.defaultWriteCharacteristic.properties.write
      ? "writeValueWithResponse"
      : "writeValueWithoutResponse";
    await this.defaultWriteCharacteristic[method](frame);
  }
}

const BLE = new BLEManager();
// Export public API for BLE module
export default {
  connect: () => BLE.connect(),
  disconnect: () => BLE.disconnect(),
  sendCommand: (cmd) => BLE.sendCommand(cmd),

  onMessageNotify: (fn) => (BLE.onMessageNotify = fn),
  onStatusChange: (fn) => (BLE.onStatusChange = fn),
  onDataReceived: (fn) => (BLE.onDataReceived = fn),
};
