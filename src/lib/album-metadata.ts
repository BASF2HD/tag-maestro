import {
  normalizedTitle,
  titleSimilarity,
  songTitleSimilarity,
  songTitleParts,
  conflictingSongVersions,
  appleAlbumReference,
} from "../../shared/metadata-matching.mjs";
export { normalizedTitle, titleSimilarity, appleAlbumReference };
import type { AlbumGroup } from "./album-groups";
import type { Mp3File, Mp3Tags } from "./mp3";

export type MetadataField =
  | "album"
  | "albumArtist"
  | "year"
  | "genre"
  | "composer"
  | "title"
  | "artist"
  | "track"
  | "discnumber";
export const METADATA_FIELDS: { key: MetadataField; label: string }[] = [
  { key: "album", label: "Album" },
  { key: "albumArtist", label: "Album artist" },
  { key: "year", label: "Year" },
  { key: "genre", label: "Genre" },
  { key: "composer", label: "Composer" },
  { key: "title", label: "Song title" },
  { key: "artist", label: "Artist / singers" },
  { key: "track", label: "Track number" },
  { key: "discnumber", label: "Disc number" },
];
export type Provider = "apple" | "spotify" | "wikipedia" | "jiosaavn" | "deezer" | "web";
export const PROVIDERS: Provider[] = ["apple", "spotify", "wikipedia", "jiosaavn", "deezer", "web"];
export const SOURCE_LABELS: Record<Provider, string> = {
  apple: "Apple catalog",
  spotify: "Spotify",
  wikipedia: "Wikipedia",
  web: "Web page",
  jiosaavn: "JioSaavn",
  deezer: "Deezer",
};
export type Candidate = {
  id: string;
  name: string;
  artist?: string;
  year?: string;
  url: string;
  trackCount?: number;
  similarity?: number;
  page?: boolean;
};
type Values = Partial<Record<MetadataField, string>>;
export type RemoteTrack = Values & { duration?: number };
export type AlbumMetadata = {
  provider: Provider;
  name: string;
  url: string;
  values: Values;
  tracks: RemoteTrack[];
  notes: string[];
  preferredFields?: MetadataField[];
  trackMatches?: Record<string, number | null>;
};
export type LookupProgress = {
  requestId: string;
  stage: "cache" | "waiting" | "fetching";
  message: string;
};
export type LookupRequest = {
  requestId?: string;
  provider: Provider;
  action: "search" | "details" | "page";
  query?: string;
  id?: string;
  country?: string;
  url?: string;
  trackTitles?: string[];
  artist?: string;
};
export type LookupResponse = {
  json?: any;
  html?: string;
  supplementalHtml?: string;
  warnings?: string[];
  url?: string;
};
export type MetadataBridge = {
  onMetadataProgress?(callback: (progress: LookupProgress) => void): () => void;
  metadataStatus?(): Promise<{ ready: boolean; version: string }>;
  lookupMetadata(input: LookupRequest): Promise<LookupResponse>;
  setSpotifyToken(token: string): Promise<boolean>;
  openMetadataSource(url: string): Promise<void>;
};
export const string = (value: unknown) => (typeof value === "string" ? value.trim() : "");
export const year = (value: unknown) => string(value).match(/\b(?:18|19|20)\d{2}\b/)?.[0] || "";
const names = (value: any): string =>
  (Array.isArray(value) ? value : [value])
    .filter(Boolean)
    .map((v) => (typeof v === "string" ? v : v.name || ""))
    .filter(Boolean)
    .join("; ");
export function candidatesFrom(provider: Provider, json: any): Candidate[] {
  if (provider === "apple")
    return (json.results || [])
      .filter((v: any) => v.wrapperType === "collection")
      .map((v: any) => ({
        id: String(v.collectionId),
        name: v.collectionName,
        artist: v.artistName,
        trackCount: Number(v.trackCount) || undefined,
        similarity: v.matchSimilarity,
        year: year(v.releaseDate),
        url: v.collectionViewUrl,
      }));
  if (provider === "spotify")
    return (json.albums?.items || []).map((v: any) => ({
      id: v.id,
      name: v.name,
      artist: names(v.artists),
      trackCount: Number(v.total_tracks) || undefined,
      year: year(v.release_date),
      url: v.external_urls?.spotify,
    }));
  if (provider === "wikipedia")
    return (json.query?.search || []).map((v: any) => ({
      id: v.title,
      name: v.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(v.title.replace(/ /g, "_"))}`,
    }));
  return [];
}
export function uniqueExactCandidate(candidates: Candidate[], query: string) {
  const exact = candidates.filter(
    (c) =>
      normalizedTitle(c.name.replace(/\s*\((?:film|soundtrack|album)\)\s*$/i, "")) ===
      normalizedTitle(query),
  );
  return exact.length === 1 ? exact[0] : undefined;
}
export function likelyAlbumCandidate(candidates: Candidate[], query: string) {
  const exact = uniqueExactCandidate(candidates, query);
  if (exact) return exact;
  // Multiple exact editions must remain a choice, even if one has the same year.
  if (candidates.some((candidate) => normalizedTitle(candidate.name) === normalizedTitle(query)))
    return undefined;
  const ranked = candidates
    .map((candidate) => ({ candidate, score: titleSimilarity(candidate.name, query) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score >= 0.78 && ranked[0].score - (ranked[1]?.score || 0) >= 0.08
    ? ranked[0].candidate
    : undefined;
}
export function corroborateAlbum(group: AlbumGroup, source: AlbumMetadata) {
  const matched = group.files.filter((file) => resolvedSourceTrack(file, source)).length;
  const localYears = new Set(group.files.map((file) => year(file.tags.year)).filter(Boolean));
  const sourceYear = year(source.values.year);
  const yearConflict = Boolean(sourceYear && localYears.size && !localYears.has(sourceYear));
  return {
    matched,
    yearConflict,
    supported:
      matched >= Math.min(2, group.files.length) &&
      matched / group.files.length >= 0.6 &&
      !yearConflict,
  };
}
export function catalogMetadata(
  provider: "apple" | "spotify",
  json: any,
  candidate: Candidate,
): AlbumMetadata {
  if (provider === "apple") {
    const album = json.results?.find((v: any) => v.wrapperType === "collection");
    if (!album || String(album.collectionId) !== candidate.id)
      throw new Error("Apple returned a different album.");
    const tracks = json.results
      .filter((v: any) => v.wrapperType === "track" && String(v.collectionId) === candidate.id)
      .map((v: any) => ({
        title: string(v.trackName),
        artist: string(v.artistName),
        track: String(v.trackNumber || ""),
        discnumber: String(v.discNumber || ""),
        duration: Number(v.trackTimeMillis) / 1000,
      }));
    return {
      provider,
      name: album.collectionName,
      url: album.collectionViewUrl || candidate.url,
      values: {
        album: album.collectionName,
        albumArtist: album.artistName,
        year: year(album.releaseDate),
        genre: album.primaryGenreName,
      },
      tracks,
      notes: [
        "Apple catalog release year may describe a reissue. Composer and singer roles are not inferred from album artist.",
        ...(album.trackCount > tracks.length ? ["Apple returned an incomplete track list."] : []),
      ],
    };
  }
  if (json.id !== candidate.id) throw new Error("Spotify returned a different album.");
  return {
    provider,
    name: json.name,
    url: json.external_urls?.spotify || candidate.url,
    values: {
      album: json.name,
      albumArtist: names(json.artists),
      year: year(json.release_date),
      genre: names(json.genres),
    },
    tracks: (json.tracks?.items || []).map((v: any) => ({
      title: string(v.name),
      artist: names(v.artists),
      track: String(v.track_number || ""),
      discnumber: String(v.disc_number || ""),
      duration: Number(v.duration_ms) / 1000,
    })),
    notes: [
      "Spotify release year may describe a reissue. Track artists are performers; composer roles are not inferred.",
    ],
  };
}
function cleanCell(element: Element | undefined): string {
  if (!element) return "";
  const node = element.cloneNode(true) as Element;
  node.querySelectorAll("sup,script,style,.sortkey,.noprint,.reference").forEach((n) => n.remove());
  node.querySelectorAll("br").forEach((n) => n.replaceWith("; "));
  node.querySelectorAll("li").forEach((n) => n.append("; "));
  return (node.textContent || "")
    .replace(/\[\d+\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/;\s*$/, "")
    .replace(/^["“”]|["“”]$/g, "");
}
export function wikipediaMetadata(html: string, candidate: Candidate): AlbumMetadata {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const values: Values = {};
  const notes = [
    "Wikipedia credits are read from labeled infobox fields and track tables. Review the article and edition.",
  ];
  for (const row of doc.querySelectorAll(".infobox tr")) {
    const header = row.querySelector(":scope > th");
    const cell = row.querySelector(":scope > td");
    if (!header || !cell) continue;
    const key = cleanCell(header).toLowerCase();
    const value = cleanCell(cell);
    if (/^(music by|composed by|composer)$/.test(key)) values.composer = value;
    if (/^(artist|by)$/.test(key)) values.albumArtist = value;
    if (/^genre$/.test(key)) values.genre = value;
    if (/^released$/.test(key)) values.year = year(value);
    if (/^release date/.test(key) && !values.year) {
      values.year = year(value);
      notes.push(
        "This year comes from the film release date; it may differ from the soundtrack release.",
      );
    }
  }
  const tracks: RemoteTrack[] = [];
  for (const table of doc.querySelectorAll("table")) {
    let headers: string[] = [];
    const carried = new Map<number, { cell: Element; remaining: number }>();
    for (const row of table.rows) {
      const cells: Element[] = [];
      for (const [column, span] of carried) {
        cells[column] = span.cell;
        if (--span.remaining <= 0) carried.delete(column);
      }
      let column = 0;
      for (const cell of row.cells) {
        while (cells[column]) column++;
        const width = Math.min(32, Math.max(1, cell.colSpan));
        for (let offset = 0; offset < width; offset++) {
          cells[column + offset] = cell;
          if (cell.rowSpan > 1)
            carried.set(column + offset, { cell, remaining: Math.min(1000, cell.rowSpan - 1) });
        }
        column += width;
      }
      const labels = cells.map((c) => cleanCell(c).toLowerCase());
      if (
        labels.some((l) => /^(title|song|song title|track|track title)$/.test(l)) &&
        cells.some((c) => c.tagName === "TH")
      ) {
        headers = labels;
        continue;
      }
      if (!headers.length || cells.length !== headers.length) continue;
      const track: RemoteTrack = {};
      headers.forEach((header, index) => {
        const value = cleanCell(cells[index]);
        if (/^(title|song|song title|track title)$/.test(header)) track.title = value;
        if (/^(singer(?:s|\(s\))?|vocals?|artist(?:s|\(s\))?|performer(?:s|\(s\))?)$/.test(header))
          track.artist = value;
        if (/^(composer(?:s|\(s\))?|music|music by)$/.test(header)) track.composer = value;
        if (/^(no\.?|#|track|track no\.?)$/.test(header)) track.track = value.match(/^\d+/)?.[0];
      });
      if (track.title && !/^(total length|bonus tracks)/i.test(track.title)) tracks.push(track);
    }
  }
  if (tracks.length) {
    values.album = candidate.name.replace(/\s*\((?:film|soundtrack|album)\)\s*$/i, "");
    notes.push(
      "Album name uses the article title because a labeled soundtrack track list is present; review the title.",
    );
  }
  return { provider: "wikipedia", name: candidate.name, url: candidate.url, values, tracks, notes };
}
export function webMetadata(html: string, url: string): AlbumMetadata {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const nodes: any[] = [];
  const visit = (v: any, depth = 0) => {
    if (!v || typeof v !== "object" || depth > 12 || nodes.length > 5000) return;
    if (Array.isArray(v)) {
      v.forEach((n) => visit(n, depth + 1));
      return;
    }
    nodes.push(v);
    for (const child of Object.values(v)) if (typeof child === "object") visit(child, depth + 1);
  };
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(script.textContent || ""));
    } catch {}
  }
  const albums = nodes.filter((v) =>
    [v["@type"]].flat().some((t: any) => /(?:^|[\/#])MusicAlbum$/.test(String(t))),
  );
  if (albums.length !== 1)
    throw new Error(
      albums.length
        ? "This page describes multiple albums. Use an individual album page."
        : "No structured MusicAlbum metadata found on this page.",
    );
  const album = albums[0];
  const rawTracks = album.track?.itemListElement || album.track || [];
  const tracks = (Array.isArray(rawTracks) ? rawTracks : [rawTracks])
    .map((entry: any) => {
      const value = entry.item || entry;
      const resolved =
        value["@id"] && !value.name
          ? nodes.find((n) => n["@id"] === value["@id"] && n.name) || value
          : value;
      return {
        title: string(resolved.name),
        artist: names(resolved.byArtist),
        composer: names(
          resolved.composer ||
            resolved.musicBy ||
            resolved.recordingOf?.composer ||
            resolved.recordingOf?.musicBy,
        ),
        track: String(entry.position || resolved.position || ""),
        discnumber: String(resolved.discNumber || ""),
      };
    })
    .filter((t: RemoteTrack) => t.title);
  return {
    provider: "web",
    name: string(album.name),
    url,
    values: {
      album: string(album.name),
      albumArtist: names(album.byArtist),
      composer: names(album.composer || album.musicBy),
      year: year(album.datePublished),
      genre: names(album.genre),
    },
    tracks,
    notes: ["Only explicit structured MusicAlbum / track fields are imported from this page."],
  };
}
function filenameTitle(file: Mp3File) {
  const base = file.file.name.replace(/\.[^.]+$/, "");
  const parts = base.split(/\s+-\s+/);
  if (parts.length >= 3 && /^\d+$/.test(parts[1])) return parts.slice(2).join(" - ");
  return base.replace(/^\d+[\s._-]+/, "");
}
export function fileTrackNumber(file: Mp3File) {
  const tag = Number(file.tags.track.split("/")[0]);
  const parts = file.file.name.replace(/\.[^.]+$/, "").split(/\s+-\s+/);
  const fromName = Number(
    parts.length >= 3 && /^\d+$/.test(parts[1])
      ? parts[1]
      : file.file.name.match(/^(\d+)[\s._-]+/)?.[1],
  );
  if (tag > 0 && fromName > 0 && tag !== fromName) return undefined;
  return tag > 0 ? tag : fromName > 0 ? fromName : undefined;
}
export function trackMatchSuggestions(file: Mp3File, tracks: RemoteTrack[]) {
  const keys = [file.tags.title, filenameTitle(file)].filter(Boolean);
  const explicitVersions = keys.filter((key) => songTitleParts(key).variants.length);
  const versionKeys = explicitVersions.length ? explicitVersions : keys;
  return tracks
    .map((track, index) => ({
      track,
      index,
      score: Math.max(0, ...keys.map((key) => songTitleSimilarity(key, track.title || ""))),
      versionConflict: versionKeys.every((key) => conflictingSongVersions(key, track.title || "")),
    }))
    .filter((suggestion) => suggestion.track.title)
    .sort((a, b) => b.score - a.score);
}
export function matchRemoteTrack(file: Mp3File, tracks: RemoteTrack[], allowNumbers = false) {
  const keys = [file.tags.title, filenameTitle(file)].filter(Boolean).map(normalizedTitle);
  const number = fileTrackNumber(file);
  const sameNumber = (track: RemoteTrack) =>
    Boolean(
      number &&
      Number(track.track) === number &&
      Number(track.discnumber || 1) === Number(file.tags.discnumber.split("/")[0] || 1),
    );
  const exact = tracks.filter(
    (track) => track.title && keys.includes(normalizedTitle(track.title)),
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    const numbered = exact.filter(sameNumber);
    return numbered.length === 1 ? numbered[0] : undefined;
  }
  const ranked = trackMatchSuggestions(file, tracks).filter(
    (suggestion) => !suggestion.versionConflict,
  );
  const best = ranked[0];
  if (best && best.score >= 0.84 && best.score - (ranked[1]?.score || 0) >= 0.08) return best.track;
  if (allowNumbers) {
    const numbered = ranked.filter((suggestion) => sameNumber(suggestion.track));
    if (numbered.length === 1) return numbered[0].track;
  }
  return undefined;
}
export function resolvedSourceTrack(file: Mp3File, source: AlbumMetadata, allowNumbers = false) {
  if (source.trackMatches && Object.hasOwn(source.trackMatches, file.id)) {
    const index = source.trackMatches[file.id];
    return index === null ? undefined : source.tracks[index];
  }
  return matchRemoteTrack(file, source.tracks, allowNumbers);
}
export type MetadataChange = {
  id: string;
  filename: string;
  field: MetadataField;
  before: string;
  after: string;
  source: Provider;
  url: string;
  matchNote?: string;
};
export type MetadataReviewStatus =
  "change" | "unchanged" | "kept" | "disabled" | "unavailable" | "unmatched";
export type MetadataReviewRow = Omit<MetadataChange, "source" | "url"> & {
  source?: Provider;
  url?: string;
  status: MetadataReviewStatus;
};
/** Fetched information stays visible even when policy prevents writing a field. */
export function metadataReview(
  album: AlbumGroup,
  sources: AlbumMetadata[],
  enabled: Set<MetadataField>,
  overwrite: boolean,
  allowNumbers = false,
): MetadataReviewRow[] {
  const rows: MetadataReviewRow[] = [];
  const ordered = [...sources].sort(
    (a, b) => PROVIDERS.indexOf(a.provider) - PROVIDERS.indexOf(b.provider),
  );
  for (const file of album.files) {
    const proposed = new Map<
      MetadataField,
      { value: string; source: AlbumMetadata; matchNote?: string }
    >();
    let hasSongMatch = false;
    for (const source of ordered) {
      const track = resolvedSourceTrack(file, source, allowNumbers);
      const manualMatch = Boolean(
        track && source.trackMatches && Object.hasOwn(source.trackMatches, file.id),
      );
      hasSongMatch ||= Boolean(track);
      const spellingDiffers = Boolean(
        track?.title &&
        ![file.tags.title, filenameTitle(file)]
          .filter(Boolean)
          .some((title) => normalizedTitle(title) === normalizedTitle(track.title!)),
      );
      for (const { key } of METADATA_FIELDS) {
        const value = string(track?.[key]) || string(source.values[key]);
        const previous = proposed.get(key);
        const prefer =
          source.preferredFields?.includes(key) && !previous?.source.preferredFields?.includes(key);
        if (value && (!previous || prefer))
          proposed.set(key, {
            value,
            source,
            matchNote:
              (spellingDiffers || manualMatch) &&
              ["title", "artist", "track", "discnumber", "composer"].includes(key)
                ? `${manualMatch ? "Manually matched" : "Word/spelling match"}: ${track!.title}`
                : undefined,
          });
      }
    }
    for (const { key: field } of METADATA_FIELDS) {
      const proposal = proposed.get(field);
      const before = file.tags[field];
      const songField = ["title", "artist", "track", "discnumber"].includes(field);
      const status: MetadataReviewStatus = !proposal
        ? songField && !hasSongMatch && ordered.some((source) => source.tracks.length)
          ? "unmatched"
          : "unavailable"
        : !enabled.has(field)
          ? "disabled"
          : before === proposal.value
            ? "unchanged"
            : !overwrite && before.trim()
              ? "kept"
              : "change";
      rows.push({
        id: file.id,
        filename: file.file.name,
        field,
        before,
        after: proposal?.value || "",
        source: proposal?.source.provider,
        url: proposal?.source.url,
        matchNote: proposal?.matchNote,
        status,
      });
    }
  }
  return rows;
}
export function changesFromReview(rows: MetadataReviewRow[]): MetadataChange[] {
  return rows.flatMap((row) =>
    row.status === "change" && row.source && row.url
      ? [
          {
            id: row.id,
            filename: row.filename,
            field: row.field,
            before: row.before,
            after: row.after,
            source: row.source,
            url: row.url,
            matchNote: row.matchNote,
          },
        ]
      : [],
  );
}
export function metadataChanges(
  album: AlbumGroup,
  sources: AlbumMetadata[],
  enabled: Set<MetadataField>,
  overwrite: boolean,
  allowNumbers = false,
): MetadataChange[] {
  return changesFromReview(metadataReview(album, sources, enabled, overwrite, allowNumbers));
}
export function changesToPatches(changes: MetadataChange[]) {
  const patches = new Map<string, Partial<Mp3Tags>>();
  for (const change of changes)
    patches.set(change.id, { ...patches.get(change.id), [change.field]: change.after });
  return patches;
}

export function isMissingMetadataService(error: unknown) {
  return /No handler registered for ['"]metadata:/.test(String(error));
}
export function metadataErrorMessage(error: unknown) {
  return isMissingMetadataService(error)
    ? "The desktop metadata service needs a full restart. Quit Tag Maestro completely and reopen it; reloading the window does not restart the service."
    : String(error).replace(/^Error: (?:Error: )?/, "");
}
