/** Artwork-only RIFF writer. Never decodes or re-encodes the audio. */
const text = new TextDecoder("latin1");
const encoder = new TextEncoder();
const ascii = (data: Uint8Array, start: number, end: number) =>
  text.decode(data.subarray(start, end));
const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);
const syncSize = (data: Uint8Array, at: number) =>
  (data[at] << 21) | (data[at + 1] << 14) | (data[at + 2] << 7) | data[at + 3];
function putSync(data: Uint8Array, at: number, size: number) {
  for (let n = 3; n >= 0; n--) {
    data[at + n] = size & 127;
    size >>>= 7;
  }
}
function join(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}
export function wavChunks(data: Uint8Array) {
  if (
    ascii(data, 0, 4) !== "RIFF" ||
    ascii(data, 8, 12) !== "WAVE" ||
    view(data).getUint32(4, true) + 8 !== data.length
  )
    throw new Error("Unsupported or truncated WAV. Original file has not been changed.");
  const chunks: { id: string; raw: Uint8Array; body: Uint8Array }[] = [];
  for (let at = 12; at < data.length;) {
    if (at + 8 > data.length) throw new Error("Truncated WAV chunk");
    const size = view(data).getUint32(at + 4, true);
    const end = at + 8 + size;
    const padded = end + (size & 1);
    if (padded > data.length) throw new Error("Truncated WAV chunk");
    chunks.push({
      id: ascii(data, at, at + 4),
      raw: data.subarray(at, padded),
      body: data.subarray(at + 8, end),
    });
    at = padded;
  }
  if (!chunks.some((chunk) => chunk.id === "data")) throw new Error("WAV has no audio data");
  return chunks;
}
export function id3Frames(tag: Uint8Array) {
  if (tag.length < 10 || ascii(tag, 0, 3) !== "ID3" || ![3, 4].includes(tag[3]) || tag[5] !== 0)
    throw new Error("Unsupported ID3 version/flags. Skipped to preserve metadata.");
  const version = tag[3];
  const end = 10 + syncSize(tag, 6);
  if (end > tag.length) throw new Error("Truncated ID3 tag");
  const frames: { id: string; raw: Uint8Array; body: Uint8Array }[] = [];
  for (let at = 10; at < end;) {
    if (tag[at] === 0) {
      if (tag.subarray(at, end).some((value) => value !== 0))
        throw new Error("Invalid ID3 padding");
      break;
    }
    if (at + 10 > end) throw new Error("Truncated ID3 frame");
    const id = ascii(tag, at, at + 4);
    const size = version === 4 ? syncSize(tag, at + 4) : view(tag).getUint32(at + 4);
    if (!/^[A-Z0-9]{4}$/.test(id) || at + 10 + size > end) throw new Error("Invalid ID3 frame");
    if (id === "APIC" && (tag[at + 8] !== 0 || tag[at + 9] !== 0))
      throw new Error("Unsupported artwork flags");
    frames.push({
      id,
      raw: tag.subarray(at, at + 10 + size),
      body: tag.subarray(at + 10, at + 10 + size),
    });
    at += 10 + size;
  }
  if (tag.subarray(end).some((value) => value !== 0))
    throw new Error("Unexpected data after ID3 tag");
  return { version, frames };
}
function isFront(body: Uint8Array) {
  const mimeEnd = body.indexOf(0, 1);
  if (mimeEnd < 0 || mimeEnd + 1 >= body.length) throw new Error("Invalid artwork metadata");
  return body[mimeEnd + 1] === 3;
}
function frame(id: string, body: Uint8Array, version: number) {
  const result = new Uint8Array(10 + body.length);
  result.set(encoder.encode(id));
  if (version === 4) putSync(result, 4, body.length);
  else view(result).setUint32(4, body.length);
  result.set(body, 10);
  return result;
}
/** Retains text, publisher tags, other artwork and every non-ID3 RIFF chunk byte-for-byte. */
export function replaceWavArtwork(data: Uint8Array, picture: Uint8Array, mime = "image/jpeg") {
  const chunks = wavChunks(data);
  const tags = chunks.filter((chunk) => chunk.id.toLowerCase() === "id3 ");
  if (tags.length > 1) throw new Error("Multiple ID3 chunks: skipped to avoid metadata loss");
  const existing = tags.length ? id3Frames(tags[0].body) : { version: 3, frames: [] };
  const kept = existing.frames
    .filter((item) => item.id !== "APIC" || !isFront(item.body))
    .map((item) => item.raw);
  const body = join([
    ...kept,
    frame(
      "APIC",
      join([new Uint8Array([0]), encoder.encode(mime), new Uint8Array([0, 3, 0]), picture]),
      existing.version,
    ),
  ]);
  const tag = new Uint8Array(10 + body.length);
  tag.set([73, 68, 51, existing.version, 0, 0]);
  putSync(tag, 6, body.length);
  tag.set(body, 10);
  const chunk = new Uint8Array(8 + tag.length + (tag.length & 1));
  chunk.set(encoder.encode("id3 "));
  view(chunk).setUint32(4, tag.length, true);
  chunk.set(tag, 8);
  let inserted = false;
  const parts = chunks.map((item) => {
    if (item.id.toLowerCase() !== "id3 ") return item.raw;
    inserted = true;
    return chunk;
  });
  if (!inserted) parts.push(chunk);
  const result = join([data.subarray(0, 12), ...parts]);
  view(result).setUint32(4, result.length - 8, true);
  return result;
}
export function wavPreservedBytes(data: Uint8Array) {
  return join(
    wavChunks(data).flatMap((chunk) =>
      chunk.id.toLowerCase() === "id3 "
        ? id3Frames(chunk.body)
            .frames.filter((item) => item.id !== "APIC" || !isFront(item.body))
            .map((item) => item.raw)
        : [chunk.raw],
    ),
  );
}
