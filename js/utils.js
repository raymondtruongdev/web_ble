class Utils1 {
  constructor() {}

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async saveFrame2JsonFile(frame) {
    // const frame = new Uint8Array([0x01, 0x92, 0x03, 0x10, 0x02, 0x5e, 0x60, 0x02, 0xff, 0x07, 0xff, 0x07]);
    const json = {
      timestamp: Date.now(),
      length: frame.length,
      data: Array.from(frame),
    };
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "frame.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async parseSensorStatus(str) {
    // Loại bỏ các dấu backtick và ký tự xuống dòng thừa
    const cleanStr = str
      .replace(/`/g, "") // Backtick
      .replace(/\0/g, "") // Null character
      .trim();
    // Tách thành các dòng
    const lines = cleanStr.split("\n").filter((line) => line.trim() !== "");
    const result = [];

    for (let line of lines) {
      // Bỏ qua dòng "Sensor Info" và "Stream status"
      if (line.includes("Sensor Info")) continue;

      // Tách tên sensor và thông tin
      const parts = line.split(":");
      if (parts.length < 2) continue;

      const name = parts[0].trim();
      const info = parts[1].trim();

      // Parse các field
      const fields = info.split(",").map((f) => f.trim());

      // Exmaple iput:
      // "Sensor Info:
      // hx712: OFF, freq=0 Hz, log=OFF
      // piezo: OFF, freq=0 Hz, log=OFF
      // ads1115: OFF, freq=0 Hz, log=OFF
      // Stream status: OFF
      // data_type_0: samplingRate=0, channels =0, sampleSize=0
      // data_type_1: samplingRate=0, channels =0, sampleSize=0"

      let active = "OFF";
      let freq = "0";
      let enableSDcardLog = "OFF";
      let samplingRate=0, channels =0, sampleSize=0
      for (let field of fields) {
        if (field.includes("freq")) {
          freq = field.split("=")[1].trim().replace(" Hz", "");
        } else if (field.includes("log")) {
          enableSDcardLog = field.split("=")[1].trim();
        } else if (field.includes("samplingRate")) {
          samplingRate = field.split("=")[1].trim();
        } else if (field.includes("channels")) {
          channels = field.split("=")[1].trim();
        } else if (field.includes("sampleSize")) {
          sampleSize = field.split("=")[1].trim();
        }else {
          // Field còn lại là status (OFF/ON)
          active = field;
        }
      }

      result.push({
        name: name,
        active: active,
        enableSDcardLog: enableSDcardLog,
        freq: freq,
        samplingRate: samplingRate,
        channels: channels,
        sampleSize: sampleSize,
      });
    }

    return result;
  }
}

export const UTILS = new Utils1();
