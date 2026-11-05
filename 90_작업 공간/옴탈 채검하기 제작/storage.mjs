// Browser-only persistence. No network or background process is used.
import { validateSettings } from './engine.mjs';
export class LocalSettingsStore {
  constructor(key = 'omtal-memory:' + location.pathname) {
    this.key = key;
    this.handle = null;
    this.database = null;
    this.writeTail = Promise.resolve();
  }

  cached(fallback) {
    try {
      const stored = localStorage.getItem(this.key);
      return stored ? validateSettings(JSON.parse(stored)) : validateSettings(fallback);
    } catch { return validateSettings(fallback); }
  }

  cache(settings) {
    try { localStorage.setItem(this.key, JSON.stringify(settings)); return true; }
    catch { return false; }
  }

  async openDatabase() {
    if (this.database) return this.database;
    this.database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('omtal-memory-files', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('handles');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('파일 연결 기록을 열 수 없습니다.'));
    });
    return this.database;
  }

  async remember(handle) {
    this.handle = handle;
    try {
      const database = await this.openDatabase();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('handles', 'readwrite');
        transaction.objectStore('handles').put(handle, this.key);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } catch { /* The current session still works if persistent file handles are unavailable. */ }
  }

  async restore() {
    try {
      const database = await this.openDatabase();
      const handle = await new Promise((resolve, reject) => {
        const request = database.transaction('handles').objectStore('handles').get(this.key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (handle?.kind !== 'file') return null;
      this.handle = handle;
      if (await handle.queryPermission({ mode: 'read' }) !== 'granted') return null;
      return this.read();
    } catch { return null; }
  }

  async read() {
    if (!this.handle) throw new Error('먼저 설정 JSON을 연결해 주세요.');
    const file = await this.handle.getFile();
    return validateSettings(JSON.parse((await file.text()).replace(/^\uFEFF/, '')));
  }

  async connect() {
    const [handle] = await showOpenFilePicker({ id: 'omtal-settings', multiple: false,
      types: [{ description: '시간 설정 JSON', accept: { 'application/json': ['.json'] } }] });
    // Ask while the user's click still provides a transient activation.
    const writable = await handle.requestPermission({ mode: 'readwrite' });
    const previous = this.handle;
    this.handle = handle;
    try {
      const settings = await this.read();
      await this.remember(handle);
      this.cache(settings);
      return { settings, writable: writable === 'granted' };
    } catch (error) { this.handle = previous; throw error; }
  }

  async prepareSave() {
    if (!this.handle) {
      const handle = await showSaveFilePicker({ id: 'omtal-settings', suggestedName: '설정.json',
        types: [{ description: '시간 설정 JSON', accept: { 'application/json': ['.json'] } }] });
      await this.remember(handle);
    } else if (await this.handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
      throw new Error('JSON 저장 권한을 허용해 주세요. 입력값은 브라우저에 보관됩니다.');
    }
  }

  async save(value) {
    const settings = validateSettings(value);
    const cached = this.cache(settings);
    const handle = this.handle;
    if (!handle || await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
      return { settings, cached, fileSaved: false };
    }
    const write = this.writeTail.catch(() => {}).then(async () => {
      const stream = await handle.createWritable();
      try { await stream.write(JSON.stringify(settings, null, 2) + '\n'); await stream.close(); }
      catch (error) { try { await stream.abort(); } catch {} throw error; }
    });
    this.writeTail = write;
    await write;
    return { settings, cached, fileSaved: true };
  }
}

export function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
