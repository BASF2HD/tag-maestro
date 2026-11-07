const https = require("node:https");
const { AsyncLocalStorage } = require("node:async_hooks");
const dns = require("node:dns/promises");
const net = require("node:net");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");

const blocked = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
])
  blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new net.BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const blockedV6 = new net.BlockList();
for (const [address, prefix] of [
  ["2001:db8::", 32],
  ["2001::", 32],
  ["2002::", 16],
])
  blockedV6.addSubnet(address, prefix, "ipv6");
function publicAddress(address) {
  const family = net.isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 && globalV6.check(address, "ipv6") && !blockedV6.check(address, "ipv6");
}
function publicURL(value) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Invalid source URL");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !url.hostname.includes(".") ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(url.hostname)
  )
    throw new Error("Use a public HTTPS album page.");
  return url;
}
async function requestText(value, headers = {}, redirects = 0) {
  const url = publicURL(value);
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error("Private or local network sources are not supported.");
  const pinned = addresses.find((address) => address.family === 4) || addresses[0];
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "TagMaestro/1.0 (personal album metadata lookup)",
          Accept: "application/json, text/html;q=0.9",
          "Accept-Encoding": "identity",
          ...headers,
        },
        lookup: (_host, options, callback) =>
          options.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
      },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.resume();
          if (redirects >= 4 || !response.headers.location)
            return reject(new Error("Too many source redirects"));
          try {
            const next = new URL(response.headers.location, url);
            // Never forward a provider credential to a redirect host.
            requestText(next.href, next.origin === url.origin ? headers : {}, redirects + 1).then(
              resolve,
              reject,
            );
          } catch {
            reject(new Error("Invalid source redirect"));
          }
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(
            new Error(
              response.statusCode === 429
                ? `Source rate limit reached. Retry later${response.headers["retry-after"] ? ` (${response.headers["retry-after"]} seconds)` : ""}.`
                : `Source returned HTTP ${response.statusCode}.`,
            ),
          );
          return;
        }
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 4 * 1024 * 1024) {
            response.destroy();
            reject(new Error("Source page exceeds 4 MB"));
          } else chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({ text: Buffer.concat(chunks).toString("utf8"), url: url.href }),
        );
        response.on("error", reject);
      },
    );
    const timer = setTimeout(
      () => request.destroy(new Error("Source request timed out (20 seconds)")),
      20000,
    );
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
  });
}
const text = (value, max = 200) => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error("Invalid metadata query");
  return value.trim();
};
class MetadataLookup {
  constructor(cacheDirectory, transport = requestText, interval = 3200) {
    this.cacheDirectory = cacheDirectory;
    this.transport = transport;
    this.interval = interval;
    this.tail = Promise.resolve();
    this.lastApple = 0;
    this.lastDeezer = 0;
    this.spotifyToken = "";
    this.progressContext = new AsyncLocalStorage();
  }
  setSpotifyToken(token) {
    if (typeof token !== "string" || token.length > 4096 || /[\r\n]/.test(token))
      throw new Error("Invalid Spotify access token");
    this.spotifyToken = token.trim();
    return Boolean(this.spotifyToken);
  }
  emit(stage, message) {
    this.progressContext.getStore()?.({ stage, message });
  }
  request(input, onProgress) {
    return this.progressContext.run(typeof onProgress === "function" ? onProgress : () => {}, () =>
      this.performRequest(input),
    );
  }
  async get(url, provider) {
    const label =
      {
        apple: "Apple catalog",
        spotify: "Spotify",
        wikipedia: "Wikipedia",
        deezer: "Deezer",
        web: "album page",
      }[provider] || "source";
    const key = createHash("sha256").update(url).digest("hex");
    const target = this.cacheDirectory && path.join(this.cacheDirectory, `${key}.json`);
    if (target) {
      try {
        const cached = JSON.parse(await fs.readFile(target, "utf8"));
        if (Date.now() - cached.time < 7 * 86400000) {
          this.emit("cache", `Using cached ${label} data`);
          return cached.result;
        }
      } catch {}
    }
    const run = async () => {
      if (provider === "spotify" && !this.spotifyToken)
        throw new Error("Spotify skipped: add an API access token in lookup settings.");
      if (provider === "apple") {
        const delay = Math.max(0, this.lastApple + this.interval - Date.now());
        if (delay > 0)
          this.emit("waiting", `Waiting ${Math.ceil(delay / 1000)}s for Apple's request limit`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        this.lastApple = Date.now();
      }
      if (provider === "deezer") {
        const delay = Math.max(0, this.lastDeezer + 250 - Date.now());
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        this.lastDeezer = Date.now();
      }
      this.emit("fetching", `Fetching ${label} data…`);
      const result = await this.transport(
        url,
        provider === "spotify" ? { Authorization: `Bearer ${this.spotifyToken}` } : {},
      );
      if (provider === "deezer") {
        const data = JSON.parse(result.text);
        if (data.error)
          throw new Error(
            `Deezer: ${data.error.message || "metadata unavailable"} (code ${data.error.code || "unknown"})`,
          );
      }
      if (target) {
        try {
          await fs.mkdir(this.cacheDirectory, { recursive: true });
          await fs.writeFile(target, JSON.stringify({ time: Date.now(), result }));
        } catch {
          /* Cache failures never discard a successful provider response. */
        }
      }
      return result;
    };
    const pending = this.tail.then(run, run);
    this.tail = pending.catch(() => {});
    return pending;
  }
  async searchApple(input, country) {
    const { albumSearchTerms, titleSimilarity, cleanMusicTitle } =
      await import("../shared/metadata-matching.mjs");
    const query = text(input.query);
    const found = new Map();
    const searched = [];
    const collect = async (term, entity = "album", attribute = "albumTerm") => {
      searched.push(term);
      const url = `https://itunes.apple.com/search?${new URLSearchParams({ term, country, media: "music", entity, attribute, limit: "200" })}`;
      const json = JSON.parse((await this.get(url, "apple")).text);
      if (json.error) throw new Error(json.error.info || "Apple lookup failed");
      for (const result of json.results || []) {
        if (!result.collectionId || !result.collectionName) continue;
        const candidate =
          result.wrapperType === "collection"
            ? result
            : {
                wrapperType: "collection",
                collectionId: result.collectionId,
                collectionName: result.collectionName,
                artistName: result.collectionArtistName || "",
                collectionViewUrl: result.collectionViewUrl,
                releaseDate: result.releaseDate,
                trackCount: result.trackCount,
              };
        if (!found.has(String(candidate.collectionId)))
          found.set(String(candidate.collectionId), candidate);
      }
    };
    const bestScore = () =>
      Math.max(0, ...[...found.values()].map((v) => titleSimilarity(v.collectionName, query)));
    for (const term of albumSearchTerms(query)) {
      await collect(term);
      if (bestScore() >= 0.78) break;
    }
    // Song and known artist clues help single-word film names with alternate spellings.
    if (bestScore() < 0.78 && Array.isArray(input.trackTitles)) {
      const songs = [
        ...new Set(
          input.trackTitles.filter(
            (value) => typeof value === "string" && value.trim().length >= 5 && value.length <= 200,
          ),
        ),
      ].slice(0, 3);
      for (const song of songs) {
        await collect(cleanMusicTitle(song), "song", "songTerm");
        if (bestScore() >= 0.78) break;
      }
    }
    if (bestScore() < 0.78 && typeof input.artist === "string" && input.artist.trim())
      await collect(text(input.artist), "album", "artistTerm");
    const results = [...found.values()]
      .map((value) => ({ ...value, matchSimilarity: titleSimilarity(value.collectionName, query) }))
      .filter((value) => value.matchSimilarity >= 0.48)
      .sort((a, b) => b.matchSimilarity - a.matchSimilarity)
      .slice(0, 20);
    return {
      json: {
        resultCount: results.length,
        results,
        searchInfo: { terms: searched, broadened: searched.length > 1 },
      },
    };
  }
  async deezerAlbum(reference) {
    const album = JSON.parse(
      (await this.get(`https://api.deezer.com/album/${reference.id}`, "deezer")).text,
    );
    if (String(album.id) !== reference.id || album.type !== "album")
      throw new Error("Deezer returned a different album.");
    const tracks = Array.isArray(album.tracks?.data) ? [...album.tracks.data] : [];
    let next = album.tracks?.next;
    const seen = new Set();
    let pageCount = 0;
    while (next) {
      const pageURL = new URL(next);
      if (pageURL.protocol === "http:" && pageURL.hostname === "api.deezer.com")
        pageURL.protocol = "https:";
      if (
        pageURL.origin !== "https://api.deezer.com" ||
        pageURL.pathname !== `/album/${reference.id}/tracks` ||
        seen.has(pageURL.href) ||
        pageCount++ >= 50 ||
        tracks.length >= 5000
      )
        throw new Error("Unsupported Deezer track pagination.");
      seen.add(pageURL.href);
      this.emit(
        "fetching",
        `Loading Deezer track list: ${tracks.length}/${album.nb_tracks || "?"} tracks`,
      );
      const page = JSON.parse((await this.get(pageURL.href, "deezer")).text);
      if (!Array.isArray(page.data)) throw new Error("Deezer returned an invalid track list.");
      tracks.push(...page.data);
      next = page.next;
    }
    const warnings = [];
    let missing = 0;
    for (let index = 0; index < tracks.length; index++) {
      const track = tracks[index];
      if (!/^[1-9]\d{0,19}$/.test(String(track.id))) {
        missing++;
        continue;
      }
      this.emit(
        "fetching",
        `Loading Deezer performer credits: ${index + 1}/${tracks.length} tracks`,
      );
      try {
        const detail = JSON.parse(
          (await this.get(`https://api.deezer.com/track/${track.id}`, "deezer")).text,
        );
        if (String(detail.id) !== String(track.id) || String(detail.album?.id) !== reference.id)
          throw new Error("Track belongs to another album.");
        tracks[index] = {
          ...track,
          contributors: detail.contributors,
          track_position: detail.track_position,
          disk_number: detail.disk_number,
          composer: detail.composer,
        };
      } catch (error) {
        missing++;
        if (/quota|rate.limit|429|too many/i.test(error.message)) {
          missing += tracks.length - index - 1;
          break;
        }
      }
    }
    if (missing)
      warnings.push(
        `Extended credits were unavailable for ${missing} tracks; the album's primary track artists were retained.`,
      );
    if (Number(album.nb_tracks) > tracks.length)
      warnings.push(`Partial track list: ${tracks.length}/${album.nb_tracks} tracks available.`);
    return {
      json: { ...album, tracks: { ...album.tracks, data: tracks } },
      url: reference.url,
      warnings,
    };
  }
  async performRequest(input) {
    if (!input || typeof input !== "object") throw new Error("Invalid metadata request");
    const { provider, action } = input;
    const country = /^[A-Z]{2}$/.test(input.country || "") ? input.country : "IN";
    let url;
    if (provider === "apple") {
      if (action === "search") return this.searchApple(input, country);
      if (action === "details") {
        const { appleAlbumReference } = await import("../shared/metadata-matching.mjs");
        const linked = input.url ? appleAlbumReference(input.url) : undefined;
        if (input.url && !linked) throw new Error("Paste a valid Apple Music album link.");
        const id = linked?.id || String(input.id);
        if (/^\d{1,20}$/.test(id))
          url = `https://itunes.apple.com/lookup?${new URLSearchParams({ id, country: linked?.country || country, entity: "song", limit: "200" })}`;
      }
    } else if (provider === "spotify") {
      if (!this.spotifyToken)
        throw new Error("Spotify skipped: add an API access token in lookup settings.");
      if (action === "search")
        url = `https://api.spotify.com/v1/search?${new URLSearchParams({ q: text(input.query), type: "album", market: country, limit: "10" })}`;
      else if (action === "details" && /^[a-zA-Z0-9]{22}$/.test(String(input.id))) {
        const result = JSON.parse(
          (
            await this.get(
              `https://api.spotify.com/v1/albums/${input.id}?market=${country}`,
              provider,
            )
          ).text,
        );
        let next = result.tracks?.next;
        let pages = 0;
        while (next && pages++ < 20) {
          const nextURL = new URL(next);
          if (
            nextURL.origin !== "https://api.spotify.com" ||
            !nextURL.pathname.startsWith(`/v1/albums/${input.id}/tracks`)
          )
            throw new Error("Invalid Spotify track pagination");
          const page = JSON.parse((await this.get(nextURL.href, provider)).text);
          result.tracks.items.push(...page.items);
          next = page.next;
        }
        if (next) throw new Error("Spotify album exceeds supported track pagination");
        return { json: result };
      }
    } else if (provider === "wikipedia") {
      if (action === "search")
        url = `https://en.wikipedia.org/w/api.php?${new URLSearchParams({ action: "query", list: "search", srsearch: text(input.query), srlimit: "8", format: "json" })}`;
      else if (action === "details")
        url = `https://en.wikipedia.org/w/api.php?${new URLSearchParams({ action: "parse", page: text(input.id), prop: "text", format: "json", redirects: "1" })}`;
    } else if (provider === "web" && action === "page") {
      const { spotifyAlbumReference, jiosaavnAlbumReference, deezerAlbumReference } =
        await import("../shared/metadata-matching.mjs");
      const source = publicURL(input.url);
      const spotify = spotifyAlbumReference(source.href);
      const jio = jiosaavnAlbumReference(source.href);
      const deezer = deezerAlbumReference(source.href);
      if (["www.deezer.com", "deezer.com"].includes(source.hostname) && !deezer)
        throw new Error("Use a Deezer album link, rather than a track, artist or playlist link.");
      if (deezer) return this.deezerAlbum(deezer);
      if (source.hostname === "open.spotify.com" && !spotify)
        throw new Error("Use a Spotify album link, rather than a track, artist or playlist link.");
      if (["www.jiosaavn.com", "jiosaavn.com"].includes(source.hostname) && !jio)
        throw new Error("Use a JioSaavn album link, rather than a song or artist link.");
      if (spotify) {
        let html = "",
          supplementalHtml = "";
        const warnings = [];
        try {
          html = (await this.get(spotify.url, "web")).text;
        } catch (error) {
          warnings.push("Spotify album page unavailable: " + error.message);
        }
        try {
          supplementalHtml = (
            await this.get(`https://open.spotify.com/embed/album/${spotify.id}`, "web")
          ).text;
        } catch (error) {
          warnings.push("Spotify public track listing unavailable: " + error.message);
        }
        if (!html && !supplementalHtml) throw new Error(warnings.join(" "));
        return { html, supplementalHtml, url: spotify.url, warnings };
      }
      const result = await this.get(jio?.url || source.href, "web");
      return { html: result.text, url: result.url };
    }
    if (!url) throw new Error("Unsupported metadata request");
    const result = await this.get(url, provider);
    const json = JSON.parse(result.text);
    if (json.error)
      throw new Error(json.error.info || json.error.message || "Provider lookup failed");
    return { json };
  }
}
module.exports = { MetadataLookup, publicURL, publicAddress, requestText };
