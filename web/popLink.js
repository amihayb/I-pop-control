/**
 * WebSocket client to the Python server (server/main.py).
 * No DOM access here — app.js registers callbacks.
 * Reconnects automatically if the Python program restarts.
 */
class PopLink {
  constructor({ onMessage, onOpen, onClose }) {
    this.onMessage = onMessage;
    this.onOpen    = onOpen;
    this.onClose   = onClose;
    this.ws        = null;
    this._open();
  }

  get isOpen() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  _open() {
    const url = `ws://${location.host}/ws`;
    this.ws = new WebSocket(url);
    this.ws.onopen    = () => this.onOpen && this.onOpen();
    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      this.onMessage && this.onMessage(msg);
    };
    this.ws.onclose = () => {
      this.onClose && this.onClose();
      setTimeout(() => this._open(), 1000);
    };
  }

  send(obj) {
    if (!this.isOpen) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }
}
