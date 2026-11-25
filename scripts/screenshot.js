// Screenshot helper (not part of the entry): renders dashboard/index.html in
// headless Chrome via CDP and saves a PNG. Usage:
//   node scripts/screenshot.js <url> <out.png> [width] [height] [waitMs]
// Chrome is launched directly with the Hatch WebGL domain-policy switches;
// the stock --screenshot flag does not work in this build, so this script
// drives Page.captureScreenshot over a local DevTools WebSocket instead.
// Screenshot via Chrome DevTools Protocol over a local WebSocket.
// Node stdlib only (raw net.Socket + minimal WS framing).
// Usage: node shot2.js <url> <out.png> [width] [height] [waitMs]
const { spawn, execSync } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const fs = require('node:fs');

const [url, out, w = '1440', h = '900', waitMs = '2500'] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: node shot2.js <url> <out.png> [width] [height] [waitMs]');
  process.exit(2);
}
const PORT = 9223 + Math.floor(Math.random() * 100);
const PROFILE = `/tmp/chr-prof-shot-${PORT}`;
const POLICY = '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt';
const SHA = crypto.createHash('sha256').update(fs.readFileSync(POLICY)).digest('hex');

function httpJson(method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(d));
        } catch {
          resolve(d);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

class WS {
  constructor(wsUrl) {
    const m = wsUrl.match(/^ws:\/\/([^:/]+):(\d+)(\/.*)$/);
    this.host = m[1];
    this.port = parseInt(m[2], 10);
    this.path = m[3];
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.handlers = new Map();
    this.events = [];
    this.nextId = 1;
  }
  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      this.sock = net.connect(this.port, this.host, () => {
        this.sock.write(
          `GET ${this.path} HTTP/1.1\r\nHost: ${this.host}:${this.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
        );
      });
      let upgraded = false;
      let head = Buffer.alloc(0);
      this.sock.on('data', (chunk) => {
        if (!upgraded) {
          head = Buffer.concat([head, chunk]);
          const idx = head.indexOf('\r\n\r\n');
          if (idx < 0) return;
          upgraded = true;
          this.buf = head.subarray(idx + 4);
          resolve();
          this.drain();
        } else {
          this.buf = Buffer.concat([this.buf, chunk]);
          this.drain();
        }
      });
      this.sock.on('error', reject);
    });
  }
  drain() {
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        off = 10;
      }
      if (this.buf.length < off + len) return;
      const payload = this.buf.subarray(off, off + len);
      this.buf = this.buf.subarray(off + len);
      if (op === 9) {
        this.sendRaw(0x8a, payload);
        continue;
      }
      if (op === 8) continue;
      if (op === 1 || op === 0) {
        this.frags.push(payload);
        if (!fin) continue;
        const full = Buffer.concat(this.frags);
        this.frags = [];
        let msg;
        try {
          msg = JSON.parse(full.toString('utf8'));
        } catch {
          continue;
        }
        if (msg.id && this.handlers.has(msg.id)) {
          this.handlers.get(msg.id)(msg.result || {});
          this.handlers.delete(msg.id);
        } else if (msg.method) {
          this.events.push(msg);
        }
      }
    }
  }
  sendRaw(firstByte, payload) {
    const mask = crypto.randomBytes(4);
    let header;
    const len = payload.length;
    if (len < 126) header = Buffer.from([firstByte, 0x80 | len]);
    else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = firstByte;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = firstByte;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    this.sock.write(Buffer.concat([header, mask, masked]));
  }
  call(method, params) {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.handlers.set(id, resolve);
      this.sendRaw(0x81, Buffer.from(JSON.stringify({ id, method, params: params || {} })));
    });
  }
  waitEvent(method, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        const i = this.events.findIndex((e) => e.method === method);
        if (i >= 0) return resolve(this.events.splice(i, 1)[0]);
        if (Date.now() - t0 > timeoutMs) return reject(new Error('timeout waiting for ' + method));
        setTimeout(tick, 150);
      };
      tick();
    });
  }
}

(async () => {
  const chrome = spawn(
    '/opt/meta-chromium/chrome',
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      `--user-data-dir=${PROFILE}`,
      `--hatch-webgl-allowed-domains-file=${POLICY}`,
      `--hatch-webgl-allowed-domains-sha256=${SHA}`,
      `--remote-debugging-port=${PORT}`,
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const kill = () => {
    try {
      chrome.kill('SIGKILL');
    } catch {}
  };
  process.on('exit', kill);
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      try {
        await httpJson('GET', '/json/version');
        up = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!up) throw new Error('chrome did not come up on port ' + PORT);
    const target = await httpJson('PUT', '/json/new?' + encodeURIComponent(url));
    const ws = new WS(target.webSocketDebuggerUrl);
    await ws.connect();
    await ws.call('Page.enable');
    await ws.call('Emulation.setDeviceMetricsOverride', {
      width: parseInt(w, 10),
      height: parseInt(h, 10),
      deviceScaleFactor: 1,
      mobile: false,
    });
    await ws.waitEvent('Page.loadEventFired', 30000).catch(() => {});
    await new Promise((r) => setTimeout(r, parseInt(waitMs, 10)));
    const shot = await ws.call('Page.captureScreenshot', { format: 'png' });
    if (!shot.data) throw new Error('no screenshot data');
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('wrote', out, fs.statSync(out).size, 'bytes');
    process.exitCode = 0;
  } catch (e) {
    console.error('shot failed:', e.message);
    process.exitCode = 1;
  } finally {
    kill();
    try {
      execSync(`rm -rf ${PROFILE}`);
    } catch {}
  }
})();
