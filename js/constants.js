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

  DATATYPE_CHANNEL_NAME_MAPPING: {
    data_type_0: "R",
    data_type_1: "E",
    data_type_2: "SIM",
    data_type_3: "N",
  },

  DATATYPE_FILENAME_MAPPING: {
    data_type_0: "Resistive",
    data_type_1: "Electric",
    data_type_2: "Simulation",
    data_type_3: "NOT_DEFINE",
  },
  
  DEFAULT_SENSOR_NAME: "SENSOR",
};
