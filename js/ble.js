// js/ble.js

//  const optionalServices = [
//       "heart_rate",
//       "battery_service",
//       "device_information",
//       "0000ffe0-0000-1000-8000-00805f9b34fb", // UART
//       "current_time",
//       "00001234-0000-1000-8000-00805f9b34fb", // Custom Service
//     ];

export const BLE = (() => {
  let device = null;
  let server = null;

  const connect = async () => {
    const optionalServices = [
      "heart_rate",
      "battery_service",
      "device_information",
      "0000ffe0-0000-1000-8000-00805f9b34fb", // UART
      "current_time",
      "00001234-0000-1000-8000-00805f9b34fb", // Custom Service
    ];

    device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: optionalServices,
    });

    device.addEventListener("gattserverdisconnected", () => {
      console.warn("Disconnected");
    });

    server = await device.gatt.connect();
    return device;
  };

  const disconnect = () => {
    device?.gatt.disconnect();
  };

  const discoverServices = async () => {
    return await server.getPrimaryServices();
  };

  const getCharacteristics = async (service) => {
    return await service.getCharacteristics();
  };

  const read = async (char) => {
    return await char.readValue();
  };

  const write = async (char, data) => {
    if (char.properties.write) {
      return await char.writeValue(data);
    }
    if (char.properties.writeWithoutResponse) {
      return await char.writeValueWithoutResponse(data);
    }
    throw new Error("Không hỗ trợ write");
  };

  const startNotify = async (char, cb) => {
    await char.startNotifications();
    char.addEventListener("characteristicvaluechanged", cb);
  };

  const stopNotify = async (char, cb) => {
    await char.stopNotifications();
    char.removeEventListener("characteristicvaluechanged", cb);
  };

  return {
    connect,
    disconnect,
    discoverServices,
    getCharacteristics,
    read,
    write,
    startNotify,
    stopNotify,
  };
})();
