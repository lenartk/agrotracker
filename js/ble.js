// Web Bluetooth klient — povezava na ESP32 modul.
// Protokol: opisan v docs/PROTOCOL.md.
//
// Paketi iz ESP32 (TX characteristic, notify) so UTF-8 string-i z JSON objekti.
// Vsaka notifikacija = en JSON objekt (brez newline-ov znotraj).
// Če je zapis daljši od MTU, ga ESP32 razreže na več notify-ev s "ch"/"n" fragmenti —
// v tej fazi preprostosti sklepaj na en JSON na notify (ESP32 default MTU ~180 B zadostuje).

import { BLE } from './constants.js';

class BLEClient extends EventTarget {
  constructor(){
    super();
    this.device = null;
    this.server = null;
    this.service = null;
    this.txChar = null;
    this.rxChar = null;
    this.infoChar = null;
    this._decoder = new TextDecoder();
    this._encoder = new TextEncoder();
    this.lastMessage = null;
    this.lastMessageAt = 0;
    this.connected = false;
  }

  isSupported(){
    return !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
  }

  async connect(){
    if (!this.isSupported()){
      throw new Error('Web Bluetooth ni podprt v tem brskalniku.');
    }
    this.device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: BLE.NAME_PREFIX },
        { services: [BLE.SERVICE] }
      ],
      optionalServices: [BLE.SERVICE]
    });
    this.device.addEventListener('gattserverdisconnected', () => this._onDisconnect());
    this.server = await this.device.gatt.connect();
    this.service = await this.server.getPrimaryService(BLE.SERVICE);
    this.txChar = await this.service.getCharacteristic(BLE.TX_CHAR);
    try { this.rxChar = await this.service.getCharacteristic(BLE.RX_CHAR); } catch {}
    try { this.infoChar = await this.service.getCharacteristic(BLE.INFO_CHAR); } catch {}

    this.txChar.addEventListener('characteristicvaluechanged', (e) => this._onNotify(e));
    await this.txChar.startNotifications();

    this.connected = true;
    this.dispatchEvent(new CustomEvent('connect', { detail: { name: this.device.name } }));
    return { name: this.device.name, id: this.device.id };
  }

  async disconnect(){
    try {
      if (this.txChar) { try { await this.txChar.stopNotifications(); } catch{} }
      if (this.server && this.server.connected) this.server.disconnect();
    } catch (e) { /* ignore */ }
    this._onDisconnect();
  }

  _onDisconnect(){
    const was = this.connected;
    this.connected = false;
    this.txChar = null; this.rxChar = null; this.server = null;
    if (was) this.dispatchEvent(new CustomEvent('disconnect'));
  }

  _onNotify(e){
    const raw = this._decoder.decode(e.target.value);
    try {
      // Če pride več JSON-ov v enem notify-u (little chance), razdeli po \n
      const lines = raw.split(/\n/).map(s => s.trim()).filter(Boolean);
      for (const line of lines){
        const msg = JSON.parse(line);
        this.lastMessage = msg;
        this.lastMessageAt = Date.now();
        this.dispatchEvent(new CustomEvent('message', { detail: msg }));
        if (msg.t) this.dispatchEvent(new CustomEvent(`msg:${msg.t}`, { detail: msg }));
      }
    } catch (err){
      // Neveljaven JSON — ignoriraj, a za debug sporoči
      this.dispatchEvent(new CustomEvent('error', { detail: { reason: 'parse', raw } }));
    }
  }

  async send(obj){
    if (!this.rxChar || !this.connected) return false;
    const data = this._encoder.encode(JSON.stringify(obj));
    if (data.length > 180){
      // Ne razbijamo še — ESP32 naj opozori
      console.warn('BLE send: payload >180 B');
    }
    try {
      // writeValueWithoutResponse, če je na voljo, je hitreje
      if (this.rxChar.writeValueWithoutResponse) await this.rxChar.writeValueWithoutResponse(data);
      else await this.rxChar.writeValue(data);
      return true;
    } catch (e){
      console.warn('BLE send failed', e);
      return false;
    }
  }

  async readInfo(){
    if (!this.infoChar) return null;
    try {
      const v = await this.infoChar.readValue();
      return JSON.parse(this._decoder.decode(v));
    } catch { return null; }
  }

  status(){
    return {
      connected: this.connected,
      name: this.device?.name || null,
      lastMessageAgoMs: this.lastMessageAt ? (Date.now() - this.lastMessageAt) : null
    };
  }
}

export const ble = new BLEClient();
