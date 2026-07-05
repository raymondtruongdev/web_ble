export const CONSTANTS = {
  CONNECTION_TYPE: {
    NONE: "none",
    BLE: "ble",
    UART: "uart",
  },

  CHART_STATUS: {
    NONE: 0,
    RENDERING: 1,
    PAUSING: 2,
  },

  LOGGING_FILE_STATUS: {
    NONE: 0,
    READY: 1,
    LOGGING: 2,
    FINISH: 3,
  },

  LOGGING_MODE: {
    WRITE_FILE_DIRECTLY: 0, // ghi trực tiếp vào file trong lúc stream
    WRITE_BUFFER: 1, // ghi tạm vào bộ nhớ, cuối cùng mới xuất file
  },

  DEFAULT_SENSOR_NAME: "SENSOR",

  STREAM_TYPES: {
    data_type_0: {
      id: 0,
      name: "HX712",
      nameChartLabel: "R",
      nameLoggingFile: "Resistive",
    },
    data_type_1: {
      id: 1,
      name: "PIEZO",
      nameChartLabel: "E",
      nameLoggingFile: "Electric",
    },
    data_type_2: {
      id: 2,
      name: "STREAMING_TEST",
      nameChartLabel: "SIM",
      nameLoggingFile: "Simulation",
    },
  },
};
