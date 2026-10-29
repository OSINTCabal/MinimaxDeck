'use strict';
const fs = require('node:fs');
const [archive, destination] = process.argv.slice(2);
const fd = fs.openSync(archive, 'r');
try {
  const prefix = Buffer.alloc(16); fs.readSync(fd, prefix, 0, 16, 0);
  const length = prefix.readUInt32LE(12);
  if (length > 32 * 1024 * 1024) throw new Error('Invalid ASAR header');
  const header = Buffer.alloc(length); fs.readSync(fd, header, 0, length, 16);
  const assets = JSON.parse(header).files.out.files._next.files.static.files.media.files;
  const name = Object.keys(assets).find(n => /^desktopAppIcon\..*\.png$/.test(n));
  const entry = assets[name];
  if (!entry || entry.unpacked || entry.link || !Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > 4 * 1024 * 1024) throw new Error('MiniMax icon missing or invalid');
  const offset = 8 + prefix.readUInt32LE(4) + Number(entry.offset);
  if (!Number.isSafeInteger(offset) || offset < 16 + length || offset + entry.size > fs.fstatSync(fd).size) throw new Error('Invalid icon offset');
  const png = Buffer.alloc(entry.size);
  if (fs.readSync(fd, png, 0, png.length, offset) !== png.length || png.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid icon PNG');
  fs.writeFileSync(destination, png);
} finally { fs.closeSync(fd); }
