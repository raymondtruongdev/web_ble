// appState.js
import { CONSTANTS } from "./constants.js";
import { UI } from "./uiManager.js";

const state = {
  connectionType: CONSTANTS.CONNECTION_TYPE.NONE,
  chartStatus: CONSTANTS.CHART_STATUS.NONE,
  loggingStatus: CONSTANTS.LOGGING_FILE_STATUS.NONE,
  loggingMode: null, // "direct_mode", "buffered_mode", or null
  loggingFilename: null, // string or null
};

export const AppState = {
  get connectionType() {
    return state.connectionType;
  },
  setConnectionType(newType) {
    state.connectionType = newType;
  },
  get chartStatus() {
    return state.chartStatus;
  },
  // Set Chart status to update Chart controls buttons state
  setChartStatus(newType) {
    state.chartStatus = newType;
    UI.updateChartControlUI();
  },
  get loggingStatus() {
    return state.loggingStatus;
  },
  setLoggingStatus(newType) {
    state.loggingStatus = newType;
    UI.updateFileLoggingUI();
  },
  get loggingMode() {
    return state.loggingMode;
  },
  setLoggingMode(newMode) {
    state.loggingMode = newMode;
    UI.updateFileLoggingUI();
  },
  get loggingFilename() {
    return state.loggingFilename;
    UI.updateFileLoggingUI();
  },
  setLoggingFilename(newFilename) {
    if (newFilename === null) {
      state.loggingFilename = "...";
    } else {
      state.loggingFilename = newFilename;
    }
    UI.updateFileLoggingUI();
  },
  updateAutoFitState(isValue) {
    UI.updateAutoFitButton(isValue);
  },
};
