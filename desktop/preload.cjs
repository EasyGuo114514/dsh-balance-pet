/**
 * Preload bridge for the desktop pet window.
 *
 * CommonJS on purpose (`.cjs`): the package is `"type": "module"`, and an
 * Electron preload is loaded as CommonJS unless the file says otherwise.
 *
 * The surface is deliberately tiny. The renderer gets notifications and three
 * commands - it never touches `ipcRenderer` directly, and it never sees the
 * bridge token for anything except the Host connection it already owns.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petDesktop', {
  /**
   * Subscribe to walk state so the pet can show its running face.
   * @param callback - receives `{ walking, direction }`.
   */
  onWalk(callback) {
    ipcRenderer.on('pet:walk', (_event, state) => callback(state));
  },
  /**
   * Toggle whether the window accepts mouse input.
   * @param value - true while the pointer is over the pet.
   */
  setInteractive(value) {
    ipcRenderer.send('pet:interactive', value === true);
  },
  /** Close the companion window. */
  quit() {
    ipcRenderer.send('pet:quit');
  },
});
