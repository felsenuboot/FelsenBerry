// Local Node port of Abfielder's client-side litematic -> Sponge v2 .schem converter
// (https://abfielder.com/Products/src/schematicWriter.js?v=14, their public converter tool).
// Ported changes: pako -> node zlib, nbtify -> prismarine-nbt (with tagged-value unwrapping),
// Blob -> Buffer, CLI wrapper. Emits Sponge v2 readable by prismarine-schematic 1.3.0.
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const nbt = require('prismarine-nbt');

function writeShort(n) { const b = new Uint8Array(2); new DataView(b.buffer).setInt16(0, n, false); return b; }
function writeInt(n) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n, false); return b; }
function writeString(str) { const encoded = new TextEncoder().encode(str); return concat(writeShort(encoded.length), encoded); }
function concat(...bufs) {
  const total = bufs.reduce((sum, b) => sum + b.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of bufs) { out.set(b, offset); offset += b.length; }
  return out;
}
function writeTag(tagId, name, payload) { return concat(U8(tagId), writeString(name), payload); }
function U8(n) { return new Uint8Array([n]); }
function TAG_Compound(name, children) { return concat(writeTag(0x0A, name, concat(...children, U8(0x00)))); }
function TAG_String(name, val) { return writeTag(0x08, name, writeString(val)); }
function TAG_Short(name, val) { return writeTag(0x02, name, writeShort(val)); }
function TAG_Int(name, val) { return writeTag(0x03, name, writeInt(val)); }
function TAG_ByteArray(name, bytes) { return writeTag(0x07, name, concat(writeInt(bytes.length), bytes)); }
function TAG_List_Comp(name, compounds) {
  const payload = concat(U8(0x0A), writeInt(compounds.length), ...compounds);
  return writeTag(0x09, name, payload);
}
function TAG_Compound_Anonymous(fields) { return concat(...fields, U8(0x00)); }
function TAG_IntArray(name, ints) {
  const buf = new Uint8Array(4 + ints.length * 4);
  const view = new DataView(buf.buffer);
  view.setInt32(0, ints.length, false);
  ints.forEach((n, i) => view.setInt32(4 + i * 4, n, false));
  return writeTag(0x0B, name, buf);
}
function unwrap(v) {
  while (v && typeof v === 'object') {
    if ('value' in v) { v = v.value; continue; }
    break;
  }
  return v;
}
function writeVarInt(n) {
  const out = [];
  do { let b = n & 0x7F; n >>>= 7; if (n !== 0) b |= 0x80; out.push(b); } while (n !== 0);
  return Uint8Array.from(out);
}

export async function convertLitematicBuffer(buf) {
  const infl = gunzipSync(buf);
  const { parsed } = await nbt.parse(infl);
  const data = parsed.value;
  const root = unwrap(data.Litematic ?? data) ?? data;

  const sourceDataVer = unwrap(root.MinecraftDataVersion ?? root.DataVersion ?? 0) || 0;
  const targetDataVer = Math.max(sourceDataVer | 0, 3955);

  const regions = unwrap(root.Regions);
  const regionKey = Object.keys(regions)[0];
  const region = unwrap(regions[regionKey]);

  const sizeTag = unwrap(region.Size);
  const sizeX = unwrap(sizeTag.x), sizeY = unwrap(sizeTag.y), sizeZ = unwrap(sizeTag.z);
  const absX = Math.abs(sizeX) | 0, absY = Math.abs(sizeY) | 0, absZ = Math.abs(sizeZ) | 0;
  const volume = absX * absY * absZ;

  const posTag = unwrap(region.Position);
  const posX = unwrap(posTag?.x ?? 0) || 0, posY = unwrap(posTag?.y ?? 0) || 0, posZ = unwrap(posTag?.z ?? 0) || 0;
  const offsetX = (posX + (sizeX < 0 ? sizeX + 1 : 0)) | 0;
  const offsetY = (posY + (sizeY < 0 ? sizeY + 1 : 0)) | 0;
  const offsetZ = (posZ + (sizeZ < 0 ? sizeZ + 1 : 0)) | 0;

  const palette = unwrap(region.BlockStatePalette);
  const bitsPerBlock = Math.max(2, 32 - Math.clz32(Math.max(1, palette.length - 1)));

  const paletteList = [];
  const paletteCompound = [];
  palette.forEach((entryRaw, i) => {
    const entry = unwrap(entryRaw) ?? entryRaw;
    const name = unwrap(entry.Name);
    const propsRaw = unwrap(entry.Properties) || {};
    const propStr = Object.keys(propsRaw).sort().map(k => `${k}=${unwrap(propsRaw[k])}`).join(',');
    const id = propStr ? `${name}[${propStr}]` : name;
    paletteList.push(id);
    paletteCompound.push(TAG_Int(id, i));
  });

  const blockStates = unwrap(region.BlockStates);
  const longKeys = Object.keys(blockStates).filter(k => !isNaN(k)).sort((a, b) => a - b);
  const longs = longKeys.map(k => {
    const v = blockStates[k];
    if (typeof v === 'bigint') return v < 0 ? (v & ((1n << 64n) - 1n)) : v;
    if (typeof v === 'number') return BigInt.asUintN(64, BigInt(v));
    // prismarine-nbt longArray element: plain [hi, lo] pair
    if (Array.isArray(v) && v.length === 2) {
      const high = BigInt.asUintN(32, BigInt(v[0])) & 0xFFFFFFFFn;
      const low = BigInt.asUintN(32, BigInt(v[1])) & 0xFFFFFFFFn;
      return (high << 32n) | low;
    }
    if (v && Array.isArray(v.value) && v.value.length === 2) {
      const high = BigInt.asUintN(32, BigInt(v.value[0])) & 0xFFFFFFFFn;
      const low = BigInt.asUintN(32, BigInt(v.value[1])) & 0xFFFFFFFFn;
      return (high << 32n) | low;
    }
    throw new Error('Invalid BlockStates format: ' + JSON.stringify(v).slice(0, 80));
  });

  const paletteIndices = [];
  for (let i = 0n; i < BigInt(volume); i++) {
    const bitIndex = i * BigInt(bitsPerBlock);
    const longIndex = Number(bitIndex >> 6n);
    const bitOffset = Number(bitIndex & 63n);
    let idx;
    if (bitOffset + bitsPerBlock <= 64) {
      idx = Number((longs[longIndex] >> BigInt(bitOffset)) & ((1n << BigInt(bitsPerBlock)) - 1n));
    } else {
      const lowBits = 64 - bitOffset;
      const highBits = bitsPerBlock - lowBits;
      const lowPart = longs[longIndex] >> BigInt(bitOffset);
      const highPart = longs[longIndex + 1] & ((1n << BigInt(highBits)) - 1n);
      idx = Number((highPart << BigInt(lowBits)) | lowPart);
    }
    idx = idx & ((1 << bitsPerBlock) - 1);
    if (idx < 0 || idx >= paletteList.length) idx = 0;
    paletteIndices.push(idx);
  }

  const blockDataBytes = [];
  for (const idx of paletteIndices) {
    const encoded = writeVarInt(idx >>> 0);
    for (const b of encoded) blockDataBytes.push(b);
  }
  const packedBytes = new Uint8Array(blockDataBytes);

  const tileEntities = unwrap(region.TileEntities) || [];
  const blockEntities = (Array.isArray(tileEntities) ? tileEntities : [])
    .map(raw => {
      const t = unwrap(raw) ?? raw;
      const x = unwrap(t.x), y = unwrap(t.y), z = unwrap(t.z);
      const id = unwrap(t.Id ?? t.id);
      if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' || typeof id !== 'string' || !id) return null;
      return TAG_Compound_Anonymous([TAG_IntArray('Pos', [x | 0, y | 0, z | 0]), TAG_String('Id', id)]);
    })
    .filter(Boolean);

  const nbtData = TAG_Compound('Schematic', [
    TAG_Short('Width', absX),
    TAG_Short('Height', absY),
    TAG_Short('Length', absZ),
    TAG_Int('PaletteMax', paletteList.length),
    TAG_Compound('Palette', paletteCompound),
    TAG_ByteArray('BlockData', packedBytes),
    TAG_List_Comp('BlockEntities', blockEntities),
    TAG_IntArray('Offset', [offsetX, offsetY, offsetZ]),
    TAG_Compound('Metadata', [
      TAG_Int('WEOffsetX', offsetX),
      TAG_Int('WEOffsetY', offsetY),
      TAG_Int('WEOffsetZ', offsetZ),
    ]),
    TAG_Int('DataVersion', targetDataVer),
    TAG_Int('Version', 2),
  ]);

  return gzipSync(nbtData);
}

// CLI: node lite2schem.mjs in.litematic out.schem
const [inFile, outFile] = process.argv.slice(2);
if (inFile && outFile) {
  const out = await convertLitematicBuffer(readFileSync(inFile));
  writeFileSync(outFile, out);
  console.log(`converted ${inFile} -> ${outFile} (${out.length} bytes)`);
}
