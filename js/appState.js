// appState.js
import { CONSTANTS } from "./constants.js";
import { UI } from "./uiManager.js";

const state = {
  connectionType: CONSTANTS.CONNECTION_TYPE.NONE,
  chartStatus: CONSTANTS.CHART_STATUS.NONE,
  loggingStatus: CONSTANTS.LOGGING_FILE_STATUS.NONE,
  loggingMode: null, // "direct_mode", "buffered_mode", or null
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

  get loggingMode() {
    return state.loggingMode;
  },

  set loggingMode(value) {
    state.loggingMode = value;
  },

  setLoggingPanelVisible(isValue) {
    UI.setLoggingPanelVisible(isValue);
  },

  setLoggingPanelStatus(newType) {
    state.loggingStatus = newType;
    UI.setLoggingPanelStatus(state.loggingStatus);
  },

  updateAutoFitState(isValue) {
    UI.updateAutoFitButton(isValue);
  },
};
