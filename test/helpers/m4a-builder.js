// Builds a synthetic AAC-LC M4A (mdat first, moov last, like Voice Memos). Frame i is filled with (i & 255).
function box(type, ...parts) {
  const body = Buffer.concat(parts);
  const h = Buffer.alloc(8);
  h.writeUInt32BE(body.length + 8, 0);
  h.write(type, 4, 'latin1');
  return Buffer.concat([h, body]);
}
const full = (type, ...parts) => box(type, Buffer.alloc(4), ...parts);
const u32 = (...v) => u32a(v);
const u32a = (v) => { const b = Buffer.alloc(v.length * 4); for (let i = 0; i < v.length; i++) b.writeUInt32BE(v[i], i * 4); return b; };
const desc = (tag, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag, body.length]), body]); };

const frameSize = (i) => 100 + (i % 50);

function makeM4a(seconds, { sampleRate = 44100, codec = 'mp4a', co64 = false, noMoov = false, perChunk = 10 } = {}) {
  const spf = 1024, n = Math.round((seconds * sampleRate) / spf);
  const ftyp = box('ftyp', Buffer.from('M4A '), u32(0), Buffer.from('M4A mp42isom'));
  const frames = [];
  for (let i = 0; i < n; i++) frames.push(Buffer.alloc(frameSize(i), i & 255));
  const mdat = box('mdat', Buffer.concat(frames));
  const dataStart = ftyp.length + 8;

  const chunkOffsets = [];
  let off = dataStart;
  for (let i = 0; i < n; i++) { if (i % perChunk === 0) chunkOffsets.push(off); off += frameSize(i); }

  const freqIdx = { 48000: 3, 44100: 4, 32000: 5, 16000: 8 }[sampleRate];
  const asc = Buffer.from([(2 << 3) | (freqIdx >> 1), ((freqIdx & 1) << 7) | (2 << 3)]); // AOT 2, stereo
  const esds = full('esds', desc(3, Buffer.from([0, 1, 0]), desc(4, Buffer.from([0x40, 0x15, 0, 0, 0]), u32(0, 0), desc(5, asc)), desc(6, Buffer.from([2]))));
  const entry = box(codec, Buffer.alloc(6), Buffer.from([0, 1]), Buffer.alloc(8), Buffer.from([0, 2, 0, 16, 0, 0, 0, 0]), u32(sampleRate * 65536), esds);
  const stsd = full('stsd', u32(1), entry);
  const stts = full('stts', u32(1, n, spf));
  const stsc = full('stsc', u32(1, 1, perChunk, 1));
  const stsz = full('stsz', u32(0, n), u32a(Array.from({ length: n }, (_, i) => frameSize(i))));
  let stco;
  if (co64) { const b = Buffer.alloc(chunkOffsets.length * 8); chunkOffsets.forEach((o, i) => b.writeBigUInt64BE(BigInt(o), i * 8)); stco = full('co64', u32(chunkOffsets.length), b); }
  else stco = full('stco', u32(chunkOffsets.length), u32a(chunkOffsets));
  const mdhd = full('mdhd', u32(0, 0, sampleRate, n * spf), u32(0));
  const hdlr = full('hdlr', u32(0), Buffer.from('soun'), Buffer.alloc(13));
  const minf = box('minf', box('stbl', stsd, stts, stsc, stsz, stco));
  const moov = box('moov', box('mvhd', Buffer.alloc(100)), box('trak', box('mdia', mdhd, hdlr, minf)));
  return new Uint8Array(Buffer.concat(noMoov ? [ftyp, mdat] : [ftyp, mdat, moov]));
}
module.exports = { makeM4a, frameSize };
