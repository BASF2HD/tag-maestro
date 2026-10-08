import assert from "node:assert/strict";
import {
  replaceWavArtwork,
  wavPreservedBytes,
  wavChunks,
  id3Frames,
} from "../src/lib/wav-artwork.ts";
const enc = new TextEncoder();
function join(...parts) {
  const result = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    result.set(p, at);
    at += p.length;
  }
  return result;
}
function chunk(id, body) {
  const result = new Uint8Array(8 + body.length + (body.length & 1));
  result.set(enc.encode(id));
  new DataView(result.buffer).setUint32(4, body.length, true);
  result.set(body, 8);
  return result;
}
function frame(id, body) {
  const result = new Uint8Array(10 + body.length);
  result.set(enc.encode(id));
  new DataView(result.buffer).setUint32(4, body.length);
  result.set(body, 10);
  return result;
}
function wav(parts) {
  const header = enc.encode("RIFF0000WAVE");
  const result = join(header, ...parts);
  new DataView(result.buffer).setUint32(4, result.length - 8, true);
  return result;
}
const text = frame("TIT2", enc.encode("\0Keep song title"));
const back = frame(
  "APIC",
  join(new Uint8Array([0]), enc.encode("image/jpeg"), new Uint8Array([0, 4, 0, 1, 2])),
);
const old = frame(
  "APIC",
  join(new Uint8Array([0]), enc.encode("image/jpeg"), new Uint8Array([0, 3, 0, 8, 9])),
);
const tag = join(new Uint8Array([73, 68, 51, 3, 0, 0, 0, 0, 0, 0]), text, back, old);
let length = tag.length - 10;
for (let n = 9; n >= 6; n--) {
  tag[n] = length & 127;
  length >>>= 7;
}
const input = wav([
  chunk("fmt ", new Uint8Array(16)),
  chunk("data", new Uint8Array([1, 2, 3, 4])),
  chunk("JUNK", new Uint8Array([7])),
  chunk("id3 ", tag),
]);
const output = replaceWavArtwork(input, new Uint8Array([11, 12, 13]));
assert.deepEqual(wavPreservedBytes(input), wavPreservedBytes(output));
const frames = id3Frames(wavChunks(output).find((c) => c.id === "id3 ").body).frames;
assert.deepEqual(frames[0].raw, text);
assert.deepEqual(frames[1].raw, back);
assert.equal(frames.filter((f) => f.id === "APIC").length, 2);
assert.deepEqual(wavChunks(output).find((c) => c.id === "data").body, new Uint8Array([1, 2, 3, 4]));
assert.throws(() => replaceWavArtwork(input.subarray(0, input.length - 1), new Uint8Array([1])));
const flagged = tag.slice();
flagged[5] = 128;
assert.throws(() =>
  replaceWavArtwork(
    wav([chunk("data", new Uint8Array([1, 2])), chunk("id3 ", flagged)]),
    new Uint8Array([1]),
  ),
);
assert.throws(() =>
  replaceWavArtwork(
    wav([chunk("data", new Uint8Array([1, 2])), chunk("id3 ", tag), chunk("id3 ", tag)]),
    new Uint8Array([1]),
  ),
);
const noCover = wav([chunk("data", new Uint8Array([1, 2]))]);
assert.deepEqual(
  wavPreservedBytes(noCover),
  wavPreservedBytes(replaceWavArtwork(noCover, new Uint8Array([1]))),
);
console.log(
  "PASS: artwork replacement, back-cover preservation, audio/text/JUNK retention, no-cover insertion, truncated/multiple/flagged tag refusal",
);
