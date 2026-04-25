// js/utils/decoder.js

export const decode = (dataView, uuid) => {
  let hex = "";

  for (let i = 0; i < dataView.byteLength; i++) {
    hex += dataView.getUint8(i).toString(16).padStart(2, "0") + " ";
  }

  const shortUuid = uuid?.substring(4, 8)?.toLowerCase();

  let decoded = "--";

  try {
    // ❤️ Heart Rate
    if (shortUuid === "2a37") {
      const flags = dataView.getUint8(0);
      const rate =
        (flags & 0x01) === 0
          ? dataView.getUint8(1)
          : dataView.getUint16(1, true);

      decoded = `${rate} BPM`;
    }

    // 🔋 Battery
    else if (shortUuid === "2a19") {
      const level = dataView.getUint8(0);
      decoded = `${level} %`;
    }

    // 🧠 Default text
    else {
      const decoder = new TextDecoder("utf-8");
      const text = decoder.decode(dataView).replace(/[^\x20-\x7E]/g, "");

      decoded = text.length > 0 ? text : dataView.getUint8(0);
    }
  } catch {
    decoded = "Binary";
  }

  return {
    hex: hex.trim(),
    decoded,
  };
};