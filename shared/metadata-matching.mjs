// Tamil names have several valid Roman spellings. Similarity ranks suggestions;
// album year and matching songs corroborate them before an automatic selection.
export function cleanMusicTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(
      /\([^)]*(?:original motion picture|original film|soundtrack)[^)]*\)|\[[^\]]*(?:soundtrack)[^\]]*\]/gi,
      "",
    )
    .replace(/\s*[-–—]\s*(?:ep|single|album)\s*$/i, "")
    .replace(/\s*\((?:film|album|soundtrack)\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
export function normalizedTitle(value) {
  return cleanMusicTitle(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}
function editSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  // Provider inputs are bounded. Limit this calculation for unusually long credits.
  a = [...a].slice(0, 240);
  b = [...b].slice(0, 240);
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}
function romanForm(value) {
  // Common length/aspiration variants, without replacing all vowels or discarding
  // meaningful words (which would confuse unrelated Tamil titles).
  return value
    .replace(/aa/g, "a")
    .replace(/ee|ii/g, "i")
    .replace(/oo|uu/g, "u")
    .replace(/dh|th/g, "t")
    .replace(/bh/g, "b");
}
export function titleSimilarity(left, right) {
  const a = normalizedTitle(left),
    b = normalizedTitle(right);
  const literal = editSimilarity(a, b);
  if (a === b || !/^[a-z0-9]+$/.test(a) || !/^[a-z0-9]+$/.test(b)) return literal;
  // Keep a transliteration-equivalent title below an exact spelling in rankings.
  return Math.max(literal, editSimilarity(romanForm(a), romanForm(b)) * 0.96);
}
export function albumSearchTerms(query) {
  const clean = cleanMusicTitle(query)
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\(\d{4}\)/g, "")
    .trim();
  const words = clean.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3);
  // Search one surviving word rather than generating thousands of vowel spellings.
  return [...new Set([clean, words.at(-1), ...[...words].sort((a, b) => b.length - a.length)])]
    .filter(Boolean)
    .slice(0, 3);
}
export function appleAlbumReference(value) {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !["music.apple.com", "itunes.apple.com"].includes(url.hostname)
  )
    return undefined;
  const match = url.pathname.match(/^\/([a-z]{2})\/album\/(?:[^/]+\/)?(?:id)?(\d{1,20})\/?$/i);
  return match ? { id: match[2], country: match[1].toUpperCase() } : undefined;
}

export function spotifyAlbumReference(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "open.spotify.com" ||
    url.username ||
    url.password ||
    url.port
  )
    return undefined;
  const match = url.pathname.match(
    /^\/(?:intl-[a-z-]+\/)?(?:embed\/)?album\/([A-Za-z0-9]{22})\/?$/i,
  );
  return match ? { id: match[1], url: `https://open.spotify.com/album/${match[1]}` } : undefined;
}
export function jiosaavnAlbumReference(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    !["jiosaavn.com", "www.jiosaavn.com"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    return undefined;
  const match = url.pathname.match(/^\/album\/([^/]+)\/([A-Za-z0-9_,+%-]+)\/?$/);
  if (!match) return undefined;
  let id;
  try {
    id = decodeURIComponent(match[2]);
  } catch {
    return undefined;
  }
  return /^[A-Za-z0-9_,+-]{4,100}$/.test(id)
    ? { id, url: `https://www.jiosaavn.com/album/${match[1]}/${encodeURIComponent(id)}` }
    : undefined;
}

export function deezerAlbumReference(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    !["deezer.com", "www.deezer.com"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    return undefined;
  const match = url.pathname.match(/^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/album\/([1-9]\d{0,19})\/?$/i);
  return match ? { id: match[1], url: `https://www.deezer.com/en/album/${match[1]}` } : undefined;
}

export function songTitleParts(value) {
  let core = cleanMusicTitle(value).toLowerCase();
  const variants = [];
  for (const marker of ["female", "male", "duet"])
    if (new RegExp(`\\b${marker}\\b`).test(core)) {
      variants.push(marker);
      core = core.replace(new RegExp(`\\b${marker}\\b`, "g"), " ");
    }
  const extra = core.match(
    /(?:\(|[-–—]\s*|\s)(instrumental|karaoke|remix|reprise|live)(?:\s+version)?\)?\s*$/i,
  );
  if (extra) {
    variants.push(extra[1].toLowerCase());
    core = core.slice(0, extra.index);
  }
  if (variants.length) core = core.replace(/\bversion\b/g, " ");
  const words = core.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return { core: words.join(" "), words, variants };
}
export function conflictingSongVersions(left, right) {
  const a = songTitleParts(left).variants,
    b = songTitleParts(right).variants;
  if (!a.length || !b.length) return false;
  return a.some((value) => !b.includes(value)) || b.some((value) => !a.includes(value));
}
export function songTitleSimilarity(left, right) {
  const a = songTitleParts(left),
    b = songTitleParts(right);
  if (!a.words.length || !b.words.length) return 0;
  let previous = Array.from({ length: b.words.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.words.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.words.length; j++)
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + 1 - titleSimilarity(a.words[i - 1], b.words[j - 1]),
      );
    previous = current;
  }
  const words = 1 - previous[b.words.length] / Math.max(a.words.length, b.words.length);
  return Math.max(
    titleSimilarity(left, right),
    0.6 * words + 0.4 * titleSimilarity(a.core, b.core),
  );
}
