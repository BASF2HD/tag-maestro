import {
  appleAlbumReference,
  spotifyAlbumReference,
  jiosaavnAlbumReference,
  deezerAlbumReference,
} from "../../shared/metadata-matching.mjs";
import {
  string,
  year,
  webMetadata,
  type AlbumMetadata,
  type LookupResponse,
  type RemoteTrack,
} from "./album-metadata";

export { spotifyAlbumReference, jiosaavnAlbumReference, deezerAlbumReference };
export function linkedAlbumProvider(url: string) {
  return appleAlbumReference(url)
    ? "apple"
    : spotifyAlbumReference(url)
      ? "spotify"
      : jiosaavnAlbumReference(url)
        ? "jiosaavn"
        : deezerAlbumReference(url)
          ? "deezer"
          : undefined;
}
function jsonObjectAfter(text: string, marker: RegExp) {
  const match = marker.exec(text);
  if (!match) return undefined;
  let start = match.index + match[0].length;
  while (/\s/.test(text[start] || "x")) start++;
  if (text[start] !== "{") return undefined;
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return JSON.parse(text.slice(start, index + 1));
  }
  return undefined;
}
const creditName = (value: any): string =>
  typeof value === "string" ? value.trim() : string(value?.name) || string(value?.text);
const credits = (value: any): string =>
  [...new Set((Array.isArray(value) ? value : [value]).map(creditName).filter(Boolean))].join("; ");
function jiosaavnMetadata(html: string, url: string): AlbumMetadata {
  const reference = jiosaavnAlbumReference(url)!;
  const doc = new DOMParser().parseFromString(html, "text/html");
  let view: any;
  for (const script of doc.querySelectorAll("script")) {
    if (!script.textContent?.includes("__INITIAL_DATA__")) continue;
    try {
      view = jsonObjectAfter(script.textContent, /"albumView"\s*:/);
    } catch {
      /* Only JSON is accepted; never execute the page's JavaScript. */
    }
    if (view?.album) break;
  }
  const album = view?.album;
  if (!album || album.type !== "album")
    throw new Error(
      "JioSaavn did not expose readable album metadata. Open the source to check availability.",
    );
  if (jiosaavnAlbumReference(album.perma_url || "")?.id !== reference.id)
    throw new Error("JioSaavn returned a different album.");
  const name = creditName(album.title);
  const directComposer = credits(
    (album.artists || []).filter((artist: any) =>
      /^(composer|music director|music)$/i.test(artist.role || ""),
    ),
  );
  const description = doc.querySelector('meta[name="description"]')?.getAttribute("content") || "";
  const composer =
    directComposer || description.match(/\bmusic by\s+(.+?)\.?\s*$/i)?.[1]?.trim() || "";
  const listed = (view.modules || [])
    .filter((module: any) => module.key === "list")
    .flatMap((module: any) => module.data || []);
  const songs = (album.songs?.length ? album.songs : listed).filter(
    (song: any) => song.type === "song" && String(song.album_id || album.id) === String(album.id),
  );
  const seen = new Set();
  const tracks: RemoteTrack[] = songs
    .filter((song: any) => {
      const key = String(song.id || creditName(song.title));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((song: any, index: number) => {
      const performers = (song.subtitle || []).filter((artist: any) =>
        /^(primary_artists?|singers?|performers?)$/i.test(artist.role || ""),
      );
      const composers = (song.subtitle || []).filter((artist: any) =>
        /^(composers?|music director|music)$/i.test(artist.role || ""),
      );
      return {
        title: creditName(song.title),
        artist: credits(performers),
        composer: credits(composers),
        track: String(song.track_number || index + 1),
        duration: Number(song.duration) || undefined,
      };
    });
  if (!name || !tracks.length)
    throw new Error(
      "JioSaavn returned no album track credits. Open the source to check availability.",
    );
  const notes = [
    "JioSaavn track artists are imported as credited; some credits may include the music director. Track numbers follow the displayed album order.",
  ];
  if (composer)
    notes.push("Composer is taken from an explicit composer or “music by” credit on this page.");
  if (Number(album.song_count) > tracks.length)
    notes.push(`Partial track list: ${tracks.length} of ${album.song_count} songs were available.`);
  return {
    provider: "jiosaavn",
    name,
    url: reference.url,
    values: {
      album: name,
      albumArtist: credits(album.artists || album.subtitle),
      year: year(String(album.year || "")),
      composer,
    },
    tracks,
    notes,
  };
}
function spotifyPageMetadata(response: LookupResponse, url: string): AlbumMetadata {
  const reference = spotifyAlbumReference(url)!;
  let structured: AlbumMetadata | undefined;
  try {
    structured = webMetadata(response.html || "", reference.url);
  } catch {
    /* Public embed data may be available when JSON-LD is absent. */
  }
  const doc = new DOMParser().parseFromString(
    response.supplementalHtml || response.html || "",
    "text/html",
  );
  let entity: any;
  try {
    const next = JSON.parse(doc.querySelector("script#__NEXT_DATA__")?.textContent || "{}");
    entity = next.props?.pageProps?.state?.data?.entity;
  } catch {}
  if (entity && (entity.type !== "album" || entity.id !== reference.id))
    throw new Error("Spotify returned a different album.");
  const tracks: RemoteTrack[] = (entity?.trackList || [])
    .filter((track: any) => track.entityType === "track" || track.uri?.startsWith("spotify:track:"))
    .map((track: any, index: number) => ({
      title: string(track.title),
      artist: string(track.subtitle).replace(/\u00a0/g, " "),
      track: String(index + 1),
      duration: Number(track.duration) / 1000 || undefined,
    }));
  const name = string(entity?.name) || structured?.name || "";
  if (!name)
    throw new Error(
      "Spotify did not expose readable public album data. Try a Spotify API token or another source.",
    );
  return {
    provider: "spotify",
    name,
    url: reference.url,
    values: {
      ...structured?.values,
      album: name,
      albumArtist: string(entity?.subtitle) || structured?.values.albumArtist || "",
      year: structured?.values.year || year(entity?.releaseDate),
    },
    tracks: tracks.length ? tracks : structured?.tracks || [],
    notes: [
      "Credits read from Spotify’s public album page and embed; no login or playback is used. Composer and disc-number credits are not exposed by this listing.",
      "Track numbers follow the displayed album order. Public pages may provide partial track lists.",
      ...(response.warnings || []),
    ],
  };
}
function deezerMetadata(response: LookupResponse, url: string): AlbumMetadata {
  const reference = deezerAlbumReference(url)!;
  const album = response.json;
  if (!album || album.type !== "album" || String(album.id) !== reference.id)
    throw new Error("Deezer did not return metadata for this album.");
  const tracks: RemoteTrack[] = (album.tracks?.data || [])
    .map((track: any, index: number) => {
      const contributors = Array.isArray(track.contributors) ? track.contributors : [];
      const performers = contributors.filter((artist: any) =>
        /^(Main|Featured|Singer|Vocals?|Performer)$/i.test(artist.role || ""),
      );
      const composers = contributors.filter((artist: any) => /^Composer$/i.test(artist.role || ""));
      return {
        title: string(track.title),
        artist: credits(performers) || creditName(track.artist),
        composer: credits(composers) || string(track.composer),
        track: String(track.track_position || index + 1),
        discnumber: Number(track.disk_number) > 0 ? String(track.disk_number) : "",
        duration: Number(track.duration) || undefined,
      };
    })
    .filter((track: RemoteTrack) => track.title);
  if (!tracks.length) throw new Error("Deezer returned no album tracks.");
  const contributors = Array.isArray(album.contributors) ? album.contributors : [];
  return {
    provider: "deezer",
    name: string(album.title),
    url: reference.url,
    values: {
      album: string(album.title),
      albumArtist:
        credits(contributors.filter((artist: any) => /^Main$/i.test(artist.role || ""))) ||
        creditName(album.artist),
      year: year(album.release_date),
      genre: credits(album.genres?.data),
      composer: credits(
        contributors.filter((artist: any) => /^Composer$/i.test(artist.role || "")),
      ),
    },
    tracks,
    notes: [
      "Artist credits come from Deezer’s public album/track metadata. Main and featured performers are kept; composer is filled only from an explicit composer credit.",
      "Deezer’s release date describes this catalog edition and may differ from the original film or soundtrack year. Track numbers use album order where no explicit number is available.",
      ...(response.warnings || []),
    ],
  };
}
export function metadataFromPage(response: LookupResponse, url: string): AlbumMetadata {
  const actual = response.url || url;
  if (deezerAlbumReference(actual)) return deezerMetadata(response, actual);
  if (jiosaavnAlbumReference(actual)) return jiosaavnMetadata(response.html || "", actual);
  if (spotifyAlbumReference(actual)) return spotifyPageMetadata(response, actual);
  try {
    return webMetadata(response.html || "", actual);
  } catch (error) {
    if (String(error).includes("No structured MusicAlbum"))
      throw new Error(
        "This page does not expose supported album metadata. Apple Music, Spotify, JioSaavn and Deezer album links are supported; other sites need structured album credits.",
      );
    throw error;
  }
}
