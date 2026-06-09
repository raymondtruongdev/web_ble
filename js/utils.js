export class UTILS {
  constructor() {
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
}