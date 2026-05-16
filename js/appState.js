// appState.js
import { CONNECTION_TYPE } from "./constants.js";
import { UI } from "./uiManager.js";

const state = {
  connectionType: CONNECTION_TYPE.NONE,
};

export const AppState = {
  get connectionType() {
    return state.connectionType;
  },
  setConnectionType(newType) {
    state.connectionType = newType;
  },
};
