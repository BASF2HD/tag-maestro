// Synthetic audio and in-memory file handles only; never opens the user's music library.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CoverArtImage } from "../src/components/CoverArtImage";
import { metadataFromPage } from "../src/lib/album-page-metadata";
import { AlbumCoversDialog } from "../src/components/AlbumCoversDialog";
import { AlbumMetadataDialog } from "../src/components/AlbumMetadataDialog";
import { albumGroups } from "../src/lib/album-groups";
import {
  isFrontCover,
  scanAlbumCover,
  replaceAlbumCovers,
  loadFolderCover,
} from "../src/lib/album-covers";
import {
  METADATA_FIELDS,
  type MetadataField,
  catalogMetadata,
  candidatesFrom,
  uniqueExactCandidate,
  likelyAlbumCandidate,
  corroborateAlbum,
  matchRemoteTrack,
  trackMatchSuggestions,
  metadataChanges,
  metadataReview,
  changesFromReview,
  webMetadata,
  wikipediaMetadata,
} from "../src/lib/album-metadata";
import {
  readMp3,
  readEmbeddedArtwork,
  emptyMeta,
  emptyTags,
  writeCoverToBlob,
  writeTagsToBlob,
  type Mp3File,
} from "../src/lib/mp3";
import "../src/styles.css";
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
document.documentElement.classList.add("dark");
const fixture = window as any;
function pcm() {
  const bytes = new Uint8Array(172),
    view = new DataView(bytes.buffer),
    enc = new TextEncoder();
  bytes.set(enc.encode("RIFF"));
  view.setUint32(4, bytes.length - 8, true);
  bytes.set(enc.encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(enc.encode("data"), 36);
  view.setUint32(40, 128, true);
  return bytes;
}
async function image(color: string, name: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const context = canvas.getContext("2d")!;
  context.fillStyle = color;
  context.fillRect(0, 0, 32, 32);
  return new File(
    [await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), "image/png"))],
    name,
    { type: "image/png" },
  );
}
function fileHandle(initial: File) {
  let current = initial;
  let writes = 0;
  return {
    kind: "file",
    name: initial.name,
    getFile: async () => current,
    queryPermission: async () => "granted",
    writes: () => writes,
    set: (file: File) => {
      current = file;
    },
    createWritable: async () => {
      let pending: Blob;
      return {
        write: async (blob: Blob) => {
          pending = blob;
        },
        close: async () => {
          current = new File([pending], current.name, { lastModified: current.lastModified + 1 });
          writes++;
        },
        abort: async () => {},
      };
    },
  };
}
function directory(name: string, children: any[]) {
  return {
    kind: "directory",
    name,
    async *values() {
      yield* children;
    },
  } as any;
}
const appleCandidate = {
  id: "123",
  name: "Aayusu Nooru",
  artist: "Album Artist",
  year: "1987",
  url: "https://music.apple.com/in/album/test/123",
};
const appleJSON = {
  results: [
    {
      wrapperType: "collection",
      collectionId: 123,
      collectionName: "Aayasu Nooru (Original Motion Picture Soundtrack) - EP",
      artistName: "Album Artist",
      releaseDate: "1987-01-01",
      trackCount: 2,
      collectionViewUrl: appleCandidate.url,
    },
    ...["Aavani Masathilla", "Brahma Devan"].map((name, i) => ({
      wrapperType: "track",
      collectionId: 123,
      trackName: name,
      artistName: `Apple Singer ${i + 1}`,
      trackNumber: i + 1,
      discNumber: 1,
    })),
  ],
};
const wikiHTML =
  '<table class="infobox"><tr><th>Music by</th><td>Composer Name</td></tr><tr><th>Release date</th><td>20 November 1987</td></tr></table><table><tr><th>No.</th><th>Title</th><th>Singer(s)</th></tr><tr><th>1.</th><td>"Aavani Masathula"</td><td>Singer A<br>Singer B<sup>[1]</sup></td></tr><tr><th>2.</th><td>"Brahmadevan"</td><td>Singer C</td></tr></table><script>window.metadataExecuted=true</script>';
fixture.tagMaestroDesktop = {
  onMetadataProgress: (callback: any) => {
    fixture.progressListener = callback;
    return () => {
      fixture.progressListener = undefined;
    };
  },
  metadataStatus: async () => {
    if (fixture.serviceMissing) throw new Error("No handler registered for 'metadata:status'");
    return { ready: true, version: "test" };
  },
  lookupMetadata: async (input: any) => {
    fixture.calls.push(input);
    if (input.requestId)
      fixture.progressListener?.({
        requestId: input.requestId,
        stage: "waiting",
        message: "Waiting for album source response…",
      });
    if (fixture.delay)
      await new Promise((resolve) =>
        setTimeout(resolve, typeof fixture.delay === "number" ? fixture.delay : 150),
      );
    if (input.provider === "web" && fixture.pageResponses?.[input.url])
      return fixture.pageResponses[input.url];
    if (
      input.provider === "apple" &&
      fixture.nenjilApple &&
      (input.query?.includes("Nenjil") || input.id === "1531202195")
    )
      return {
        json:
          input.action === "search"
            ? { results: [fixture.nenjilApple.results[0]] }
            : fixture.nenjilApple,
      };
    if (input.provider === "apple")
      return { json: input.action === "search" ? { results: [appleJSON.results[0]] } : appleJSON };
    if (input.provider === "wikipedia")
      return {
        json:
          input.action === "search"
            ? { query: { search: [{ title: "Aayusu Nooru" }] } }
            : { parse: { text: { "*": wikiHTML } } },
      };
    if (input.provider === "web")
      return {
        html:
          '<script type="application/ld+json">' +
          JSON.stringify({
            "@type": "MusicAlbum",
            name: "Aayusu Nooru",
            composer: { name: "Web Composer" },
            track: [{ name: "Aavani Masathula", byArtist: { name: "Web Singer" } }],
          }) +
          "</script>",
        url: input.url,
      };
    throw new Error("Spotify fixture unavailable");
  },
  setSpotifyToken: async (token: string) => Boolean(token),
  openMetadataSource: async (url: string) => {
    fixture.openedURL = url;
  },
};
fixture.calls = [];
const largeCanvas = document.createElement("canvas");
largeCanvas.width = 2048;
largeCanvas.height = 1200;
largeCanvas.getContext("2d")!.fillStyle = "#468";
largeCanvas.getContext("2d")!.fillRect(0, 0, 2048, 1200);
fixture.largeCover = largeCanvas.toDataURL("image/png");
fixture.parseWikipedia = wikipediaMetadata;
fixture.parseAlbumPage = metadataFromPage;
fixture.validateDeezer = (response: any, spotify: any) => {
  const deezer = metadataFromPage(response, response.url);
  assert(
    deezer.provider === "deezer" &&
      deezer.name === "Irayil Payanangalil" &&
      deezer.tracks.length === 6,
    "Deezer public album reader failed",
  );
  assert(
    deezer.tracks[0].artist === "P. Jayachandran" && deezer.tracks[1].artist?.includes("Janaki"),
    "Deezer performer credits missing",
  );
  assert(
    deezer.values.albumArtist === "T. Rajendar" && !deezer.values.composer,
    "Deezer inferred composer from album artist",
  );
  assert(
    deezer.tracks[0].track === "1" && deezer.tracks[0].discnumber === "1",
    "Deezer explicit track/disc numbers missing",
  );
  const spotifyAlbum = metadataFromPage(spotify, spotify.url);
  const file = {
    id: "variant",
    file: new File([], "Irayil Payanangalil - 02 - Vasantham Aadi Vara.mp3"),
    tags: { ...emptyTags(), title: "Vasantham Aadi Vara" },
    meta: emptyMeta(),
  } as Mp3File;
  const female = spotifyAlbum.tracks.findIndex((track) => /Female/i.test(track.title || ""));
  const male = spotifyAlbum.tracks.findIndex((track) => /\bMale\b/i.test(track.title || ""));
  assert(female >= 0 && male >= 0, "Expected Female and Male source variants");
  const suggestions = trackMatchSuggestions(file, spotifyAlbum.tracks);
  assert(
    suggestions.filter((item) => item.score >= 0.84).some((item) => item.index === female) &&
      suggestions.filter((item) => item.score >= 0.84).some((item) => item.index === male),
    "Word matching did not suggest Aadi/Paadi/Padi variants",
  );
  assert(
    !matchRemoteTrack(file, spotifyAlbum.tracks),
    "Generic title silently chose a Female/Male version",
  );
  assert(
    matchRemoteTrack(
      { ...file, tags: { ...file.tags, title: "Vasantham Aadi Vara Female" } },
      spotifyAlbum.tracks,
    )?.title === spotifyAlbum.tracks[female].title,
    "Explicit Female version did not match with alternate spelling",
  );
  const group = {
    id: "variant",
    name: "Irayil Payanangalil",
    query: "Irayil Payanangalil",
    files: [file],
  };
  const chosen = { ...spotifyAlbum, trackMatches: { [file.id]: female } };
  const review = metadataReview(group, [chosen], new Set<MetadataField>(["artist"]), false);
  assert(
    review.find((row) => row.field === "artist")?.after.includes("Janaki"),
    "Manual variant selection did not use Female singer",
  );
  assert(
    review.find((row) => row.field === "artist")?.matchNote?.includes("Manually matched"),
    "Manual match was not identified in review",
  );
  const skipped = metadataReview(
    group,
    [{ ...spotifyAlbum, trackMatches: { [file.id]: null } }],
    new Set<MetadataField>(["artist"]),
    false,
  );
  assert(
    skipped.find((row) => row.field === "artist")?.status === "unmatched",
    "Explicit skip did not suppress source song credits",
  );
  const roles = metadataFromPage(
    {
      ...response,
      json: {
        ...response.json,
        tracks: {
          data: [
            {
              ...response.json.tracks.data[0],
              contributors: [
                { name: "Main singer", role: "Main" },
                { name: "Guest singer", role: "Featured" },
                { name: "Composer credit", role: "Composer" },
              ],
            },
          ],
        },
      },
    },
    response.url,
  );
  assert(
    roles.tracks[0].artist === "Main singer; Guest singer" &&
      roles.tracks[0].composer === "Composer credit",
    "Contributor roles were mixed",
  );
  fixture.deezerSource = deezer;
  fixture.pageResponses[response.url] = response;
  fixture.pageResponses[spotify.url] = spotify;
  return { album: deezer.name, tracks: deezer.tracks.length, female, male };
};

fixture.pageResponses = {};
fixture.validateVasantha = (response: any) => {
  const source = metadataFromPage(response, response.url);
  assert(
    source.provider === "jiosaavn" &&
      source.name === "Vasantha Azhaippugal" &&
      source.tracks.length === 5,
    "Vasantha album parsing failed",
  );
  const expected = [
    "Malaysia Vasudevan; S. Janaki",
    "S. Janaki",
    "P. Susheela",
    "S.P. Balasubrahmanyam",
    "T. Rajendar",
  ];
  source.tracks.forEach((track, index) =>
    assert(track.artist?.includes(expected[index]), "Vasantha song artist missing: " + track.title),
  );
  const titles = [
    "Ada Neela Selai",
    "Devalogam Azhaithalum",
    "Gangai Ponguthey",
    "Kitta Vaadi",
    "Thanthana Naalum Pochu",
  ];
  const files = titles.map(
    (title, index) =>
      ({
        id: "vasantha-" + index,
        file: new File([], `Vasantha Azhaippugal - 0${index + 1} - ${title}.mp3`),
        tags: { ...emptyTags(), title, album: source.name, artist: "Old artist" },
      }) as Mp3File,
  );
  const group = { id: "vasantha", name: source.name, query: source.name, files };
  const fields = new Set<MetadataField>(["artist", "albumArtist", "year"]);
  const apple = {
    ...source,
    provider: "apple" as const,
    url: "https://music.apple.com/in/album/example/123",
    values: { ...source.values, albumArtist: "Apple album artist" },
    tracks: source.tracks.map((track) => ({ ...track, artist: "T. Rajendar" })),
  };
  const normal = metadataReview(group, [apple, source], fields, true);
  assert(
    normal.filter((row) => row.field === "artist").every((row) => row.source === "apple"),
    "Default Apple priority changed",
  );
  const preferred = { ...source, preferredFields: ["artist" as const] };
  const protectedRows = metadataReview(group, [apple, preferred], fields, false);
  assert(
    protectedRows
      .filter((row) => row.field === "artist")
      .every((row) => row.status === "kept" && row.source === "jiosaavn"),
    "Existing singer protection lost",
  );
  const reviewed = metadataReview(group, [apple, preferred], fields, true);
  assert(
    reviewed
      .filter((row) => row.field === "artist")
      .every(
        (row, index) =>
          row.status === "change" &&
          row.after.includes(expected[index]) &&
          row.source === "jiosaavn",
      ),
    "Preferred JioSaavn singers failed with spelling differences",
  );
  assert(
    reviewed.filter((row) => row.field === "albumArtist").every((row) => row.source === "apple"),
    "Artist preference changed other source fields",
  );
  fixture.vasanthaFiles = files;
  fixture.pageResponses[response.url] = response;
  return { tracks: source.tracks.length, artists: source.tracks.map((track) => track.artist) };
};
fixture.validatePublicPages = (jio: any, spotify: any, apple?: any) => {
  const first = metadataFromPage(jio, jio.url),
    second = metadataFromPage(spotify, spotify.url);
  assert(
    first.provider === "jiosaavn" &&
      first.name === "Nenjil Oru Raagam" &&
      first.tracks.length === 6,
    "JioSaavn album data missing",
  );
  assert(first.values.composer === "T. Rajendar", "Explicit JioSaavn Music-by credit missing");
  assert(
    first.tracks[0].artist?.includes("P. Jayachandran") &&
      first.tracks[3].artist?.includes("S. Janaki"),
    "JioSaavn per-song credits missing",
  );
  assert(
    second.provider === "spotify" && second.tracks.length === 6 && second.values.year === "1982",
    "Spotify public album data missing",
  );
  assert(
    second.tracks[0].artist === "P. Jayachandran" && second.tracks[3].artist?.includes("S. Janaki"),
    "Spotify public track credits missing",
  );
  assert(!second.values.composer, "Spotify composer inferred without an explicit credit");
  const embedOnly = metadataFromPage({ ...spotify, html: "" }, spotify.url);
  assert(embedOnly.tracks.length === 6, "Spotify embed-only fallback failed");
  assert(!fixture.executedPageCode, "Remote page script executed");
  if (apple) {
    fixture.nenjilApple = apple;
    const appleSource = catalogMetadata("apple", apple, candidatesFrom("apple", apple)[0]);
    const files = second.tracks.map(
      (track, index) =>
        ({
          id: String(index),
          file: new File([], track.title + ".mp3"),
          tags: { ...emptyTags(), title: track.title, album: "Nenjil Oru Raagam" },
        }) as Mp3File,
    );
    const group = { id: "nenjil", name: "Nenjil Oru Raagam", query: "Nenjil Oru Raagam", files };
    const fields = new Set<MetadataField>(["artist", "year", "albumArtist"]);
    const normal = metadataReview(group, [appleSource, second], fields, false);
    assert(
      normal
        .filter((row) => row.field === "artist")
        .every((row) => row.after === "T Rajendar" && row.source === "apple"),
      "Default Apple priority changed",
    );
    const preferred = metadataReview(
      group,
      [appleSource, { ...second, preferredFields: ["artist"] }],
      fields,
      false,
    );
    assert(
      preferred.filter((row) => row.field === "artist").every((row) => row.source === "spotify"),
      "Preferred page artists did not override Apple track artist",
    );
    assert(
      preferred.filter((row) => row.field === "albumArtist").every((row) => row.source === "apple"),
      "Artist preference changed album-artist priority",
    );
  }
  fixture.pageResponses[jio.url] = jio;
  fixture.pageResponses[spotify.url] = spotify;
  return { jio: first.name, spotify: second.name, tracks: first.tracks.length };
};
fixture.validateApple = (json: any, wiki?: string) => {
  const candidate = candidatesFrom("apple", json)[0];
  assert(
    likelyAlbumCandidate([candidate], "Aayusu Nooru")?.id === candidate.id,
    "Album transliteration suggestion missing",
  );
  const source = catalogMetadata("apple", json, candidate);
  const titles = [
    "Aavani Masathula",
    "Brahmadevan",
    "Kummi Adikkira",
    "Etri Vaitha",
    "Chinna Ponnu",
  ];
  const rows = titles.map(
    (title, index) =>
      ({
        id: String(index),
        file: new File([], `Aayusu Nooru - 0${index + 1} - ${title}.mp3`),
        tags: { ...emptyTags(), title, year: "1987" },
        folderName: "Aayusu Nooru",
        folderPath: "Example/Aayusu Nooru",
        librarySourceId: "example",
      }) as Mp3File,
  );
  const group = { id: "example", name: "Aayusu Nooru", query: "Aayusu Nooru", files: rows };
  assert(
    corroborateAlbum(group, source).supported,
    "Real track list did not corroborate transliteration",
  );
  const changes = metadataChanges(
    group,
    [source],
    new Set(METADATA_FIELDS.map((f) => f.key)),
    true,
  );
  assert(
    changes.filter((c) => c.field === "artist").length === 5,
    "Five Apple singer credits not proposed",
  );
  assert(
    changes.find((c) => c.field === "artist" && c.id === "0")?.after.includes("S. Janaki"),
    "Apple singer attribution incorrect",
  );
  if (wiki) {
    const wikipedia = wikipediaMetadata(wiki, {
      id: "Aayusu Nooru",
      name: "Aayusu Nooru",
      url: "https://en.wikipedia.org/wiki/Aayusu_Nooru",
    });
    const existing = {
      ...group,
      files: rows.map((row) => ({
        ...row,
        tags: {
          ...row.tags,
          year: "",
          artist: "Existing singer",
          albumArtist: "Existing album artist",
          composer: "Existing composer",
        },
      })),
    };
    const review = metadataReview(
      existing,
      [source, wikipedia],
      new Set(["artist", "albumArtist", "composer", "year"]),
      false,
    );
    assert(
      review.filter(
        (row) =>
          row.field === "composer" && row.after === "T. Rajendar" && row.source === "wikipedia",
      ).length === 5,
      "Real composer credits omitted from review",
    );
    assert(
      review.filter(
        (row) =>
          row.field === "albumArtist" && row.after === "T. Rajendar" && row.source === "apple",
      ).length === 5,
      "Real album artist omitted from review",
    );
    assert(
      review.filter(
        (row) => row.field === "artist" && row.status === "kept" && row.source === "apple",
      ).length === 5,
      "Real fetched singers hidden behind existing tags",
    );
    assert(
      changesFromReview(review).length === 5 &&
        changesFromReview(review).every((row) => row.field === "year"),
      "Real existing-credit scenario should apply only five empty years by default",
    );
  }
  const conflicting = {
    ...group,
    files: rows.map((row) => ({ ...row, tags: { ...row.tags, year: "1999" } })),
  };
  assert(
    !corroborateAlbum(conflicting, source).supported,
    "Year conflict allowed automatic fuzzy album match",
  );
  assert(
    !likelyAlbumCandidate([candidate, { ...candidate, id: "other-edition" }], "Aayusu Nooru"),
    "Ambiguous transliterations auto-selected",
  );
  return {
    name: source.name,
    tracks: source.tracks.length,
    matchedSongs: corroborateAlbum(group, source).matched,
    artistChanges: changes.filter((c) => c.field === "artist").length,
  };
};

async function run() {
  assert(
    isFrontCover("Aayusunooru_Front.jpg") && isFrontCover("Backstreet Boys_Front.PNG"),
    "Front files not recognized",
  );
  assert(
    !isFrontCover("Aayusunooru_Back.jpg") &&
      !isFrontCover("Frontiers.jpg") &&
      !isFrontCover("Front_Back.jpg"),
    "Back or unrelated art selected",
  );
  const frontHandle = fileHandle(await image("#3377bb", "Aayusunooru_Front.png"));
  const backHandle = fileHandle(await image("#bb7733", "Aayusunooru_Back.png"));
  const folder = directory("Aayusu Nooru", [directory("COVERS", [frontHandle, backHandle])]);
  const oldCover = await loadFolderCover({
    name: "Old_Front.png",
    handle: fileHandle(await image("#cc3344", "Old_Front.png")) as any,
  });
  const rows: Mp3File[] = [];
  for (const [index, title] of ["Aavani Masathula", "Brahmadevan"].entries()) {
    const raw = new File([pcm()], `Aayusu Nooru - 0${index + 1} - ${title}.wav`, {
      lastModified: 1,
    });
    const seed: Mp3File = {
      id: String(index),
      file: raw,
      format: "wav",
      tags: { ...emptyTags(), title, album: "Aayusu Nooru", comment: "Preserve disk comment" },
      original: emptyTags(),
      meta: emptyMeta(),
      dirty: false,
      folderPath: "Library/Aayusu Nooru",
      folderName: "Aayusu Nooru",
      editedFolderName: "Aayusu Nooru",
    };
    const tagged = new File([await writeTagsToBlob(seed)], raw.name, { lastModified: 2 });
    const original = new File([await writeCoverToBlob(tagged, oldCover)], raw.name, {
      lastModified: 3,
    });
    const handle = fileHandle(original);
    const row = await readMp3(
      original,
      `Library/Aayusu Nooru/${raw.name}`,
      true,
      true,
      handle as any,
      folder,
    );
    row.librarySourceId = "fixture";
    row.tags.comment = "Pending editor comment";
    row.dirty = true;
    rows.push(row);
  }
  const group = albumGroups(rows)[0];
  const scan = await scanAlbumCover(group);
  assert(
    scan.candidates.length === 1 && scan.candidates[0].name === "COVERS/Aayusunooru_Front.png",
    "Case-insensitive Covers scan failed",
  );
  const missing = await scanAlbumCover({
    ...group,
    files: [{ ...rows[0], sourceDirectoryHandle: undefined }],
  });
  assert(Boolean(missing.error), "Missing folder access not reported");
  const ambiguous = await scanAlbumCover({
    ...group,
    files: [
      {
        ...rows[0],
        sourceDirectoryHandle: directory("Album", [
          directory("Covers", [frontHandle, fileHandle(await image("#eee", "Other_Front.png"))]),
        ]),
      },
    ],
  });
  assert(ambiguous.candidates.length === 2, "Ambiguous fronts lost");
  const backOnly = await scanAlbumCover({
    ...group,
    files: [
      {
        ...rows[0],
        sourceDirectoryHandle: directory("Album", [directory("Covers", [backHandle])]),
      },
    ],
  });
  assert(!backOnly.candidates.length, "Back-only album accepted");
  const many = Array.from({ length: 500 }, (_, i) => ({
    ...rows[0],
    id: `album${i}`,
    folderPath: `Library/Album${i}`,
  }));
  assert(albumGroups(many).length === 500, "500 album grouping lost entries");
  assert(
    albumGroups([rows[0], { ...rows[0], id: "other", librarySourceId: "other-root" }]).length === 2,
    "Different library roots merged",
  );
  let receipts = 0,
    stop = false;
  const callbacks = {
    cancelled: () => stop,
    progress: () => {},
    saved: (r: any) => {
      receipts++;
      rows.find((f) => f.id === r.row.id)!.file = r.file;
      stop = true;
    },
    failed: () => {
      throw new Error("Unexpected write failure");
    },
    completed: () => {},
  };
  const first = await replaceAlbumCovers([{ scan, candidate: scan.candidates[0] }], callbacks);
  assert(
    first.saved === 1 && receipts === 1,
    "Cancellation did not stop after current saved track",
  );
  const disk = await readMp3(
    await rows[0].sourceHandle!.getFile(),
    "Synthetic/song.wav",
    true,
    true,
  );
  assert(
    disk.tags.comment === "Preserve disk comment",
    "Artwork save applied staged text edits or lost disk metadata",
  );
  assert(
    disk.tags.cover?.dataUrl === (await loadFolderCover(scan.candidates[0])).dataUrl,
    "Old embedded artwork remained",
  );
  assert(frontHandle.writes() === 0 && backHandle.writes() === 0, "Source images were modified");
  stop = false;
  let staleErrors = 0;
  const stale = {
    ...rows[1],
    file: new File([rows[1].file], rows[1].file.name, { lastModified: 999 }),
  };
  const staleResult = await replaceAlbumCovers(
    [{ scan: { ...scan, album: { ...group, files: [stale] } }, candidate: scan.candidates[0] }],
    {
      ...callbacks,
      saved: () => {
        throw new Error("Stale track saved");
      },
      failed: () => {
        staleErrors++;
      },
    },
  );
  assert(staleResult.failed === 1 && staleErrors === 1, "Stale file not rejected");
  const pendingResult = await replaceAlbumCovers(
    [
      {
        scan: { ...scan, album: { ...group, files: [{ ...rows[1], coverEdited: true }] } },
        candidate: scan.candidates[0],
      },
    ],
    { ...callbacks, failed: () => {} },
  );
  assert(pendingResult.failed === 1, "Pending artwork overwritten");
  const apple = catalogMetadata("apple", appleJSON, appleCandidate);
  const wiki = wikipediaMetadata(wikiHTML, {
    id: "Aayusu Nooru",
    name: "Aayusu Nooru",
    url: "https://en.wikipedia.org/wiki/Aayusu_Nooru",
  });
  assert(
    wiki.values.composer === "Composer Name" &&
      wiki.values.year === "1987" &&
      wiki.tracks[0].artist === "Singer A; Singer B",
    "Wikipedia explicit credits not parsed",
  );
  const rowspanWiki = wikipediaMetadata(
    '<table><tr><th>No.</th><th>Title</th><th>Singer(s)</th></tr><tr><td>1</td><td>First</td><td rowspan="2">Shared Singer</td></tr><tr><td>2</td><td>Second</td></tr></table>',
    { id: "Test", name: "Test", url: "https://example.com" },
  );
  assert(
    rowspanWiki.tracks.length === 2 &&
      rowspanWiki.tracks.every((t) => t.artist === "Shared Singer"),
    "Wikipedia rowspan credits lost",
  );
  assert(!fixture.metadataExecuted, "Remote script executed");
  const fields = new Set(METADATA_FIELDS.map((f) => f.key));
  const changes = metadataChanges(group, [wiki, apple], fields, true);
  assert(
    changes.some((c) => c.field === "composer" && c.source === "wikipedia") &&
      changes.some((c) => c.field === "artist" && c.source === "apple"),
    "Priority/fallback provenance failed",
  );
  assert(
    !metadataChanges(group, [apple], fields, true).some((c) => c.field === "composer"),
    "Composer inferred from artist",
  );
  const filled = metadataChanges(
    { ...group, files: [{ ...rows[0], tags: { ...rows[0].tags, artist: "Keep" } }] },
    [apple],
    fields,
    false,
  );
  assert(!filled.some((c) => c.field === "artist"), "Fill-only replaced existing artist");
  const protectedGroup = {
    ...group,
    files: group.files.map((file) => ({
      ...file,
      tags: {
        ...file.tags,
        artist: "Old singer",
        albumArtist: "Old album artist",
        composer: "Old composer",
        year: "",
      },
    })),
  };
  const protectedReview = metadataReview(
    protectedGroup,
    [apple, wiki],
    new Set(["year", "artist", "albumArtist", "composer"]),
    false,
  );
  assert(
    protectedReview.filter((row) => row.status === "change").every((row) => row.field === "year"),
    "Fill-only review proposed replacing populated tags",
  );
  for (const field of ["artist", "albumArtist", "composer"])
    assert(
      protectedReview.some(
        (row) => row.field === field && row.status === "kept" && row.after && row.source,
      ),
      "Fetched " + field + " was hidden by fill-only policy",
    );
  assert(
    protectedReview.length === group.files.length * METADATA_FIELDS.length,
    "Review omitted disabled or unavailable fields",
  );
  assert(
    changesFromReview(protectedReview).length === group.files.length,
    "Review generated unexpected pending writes",
  );
  assert(
    metadataReview(protectedGroup, [apple], fields, false).some(
      (row) => row.field === "composer" && row.status === "unavailable",
    ),
    "Missing composer was presented as a fetched value",
  );
  const matchingGroup = {
    ...group,
    files: [
      { ...group.files[0], tags: { ...group.files[0].tags, artist: apple.tracks[0].artist! } },
    ],
  };
  assert(
    metadataReview(matchingGroup, [apple], fields, false).some(
      (row) => row.field === "artist" && row.status === "unchanged",
    ),
    "Matching fetched artist was hidden",
  );

  const unknown = {
    ...rows[0],
    file: new File([], "Unknown.wav"),
    tags: { ...rows[0].tags, title: "Different", track: "1" },
  };
  assert(!matchRemoteTrack(unknown, apple.tracks), "Unmatched title was guessed by position");
  assert(Boolean(matchRemoteTrack(unknown, apple.tracks, true)), "Explicit number match failed");
  assert(
    !matchRemoteTrack(rows[0], [apple.tracks[0], apple.tracks[0]]),
    "Duplicate titles matched ambiguously",
  );
  assert(
    !uniqueExactCandidate([appleCandidate, { ...appleCandidate, id: "456" }], "Aayusu Nooru"),
    "Ambiguous album auto-selected",
  );
  assert(
    uniqueExactCandidate([appleCandidate], "Aayusunooru")?.id === "123",
    "Spacing normalization failed",
  );
  assert(
    candidatesFrom("apple", { results: [appleJSON.results[0]] }).length === 1,
    "Catalog candidates failed",
  );
  const web = webMetadata(
    '<script type="application/ld+json">' +
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "MusicAlbum",
        name: "Example",
        byArtist: { name: "Album Artist" },
        datePublished: "1987-01-01",
        track: {
          itemListElement: [
            {
              position: 1,
              item: {
                "@type": "MusicRecording",
                name: "Song",
                byArtist: [{ name: "Singer A" }, { name: "Singer B" }],
                composer: { name: "Composer" },
              },
            },
          ],
        },
      }) +
      "</script>",
    "https://example.com/album",
  );
  assert(
    web.tracks[0].artist === "Singer A; Singer B" &&
      web.tracks[0].composer === "Composer" &&
      web.values.year === "1987",
    "Structured album data failed",
  );
  let rejected = false;
  try {
    webMetadata("<h1>No structured data</h1>", "https://example.com");
  } catch {
    rejected = true;
  }
  assert(rejected, "Unstructured page accepted");
  fixture.unitResult =
    "PASS: 500 albums, front/back scan, ambiguity, verified artwork replacement, text preservation, cancellation, stale files, provider matching, credits and provenance.";
  fixture.rows = rows;
  fixture.ready = true;
  return rows;
}
function App({ rows: initial }: { rows: Mp3File[] }) {
  const [rows, setRows] = useState(initial);
  const [covers, setCovers] = useState(false);
  const [metadata, setMetadata] = useState(false);
  const [result, setResult] = useState("No editor changes");
  return (
    <main>
      <p role="status">{result}</p>
      <CoverArtImage
        src={fixture.largeCover}
        alt="Editor artwork fixture"
        className="h-20 w-20 object-contain"
      />
      <button onClick={() => setCovers(true)}>Open covers</button>
      <button onClick={() => setMetadata(true)}>Open metadata</button>
      <button
        onClick={() =>
          setRows(
            fixture.vasanthaFiles.map((file: Mp3File) => ({
              ...initial[0],
              ...file,
              folderName: "Vasantha Azhaippugal",
              folderPath: "Synthetic/Vasantha Azhaippugal",
              sourceHandle: undefined,
            })),
          )
        }
      >
        Use Vasantha tracks
      </button>
      <button
        onClick={() =>
          setRows(
            fixture.deezerSource.tracks.map((track: any, index: number) => ({
              ...initial[0],
              id: "irayil-" + index,
              file: new File(
                [],
                `Irayil Payanangalil - 0${index + 1} - ${index === 1 ? "Vasantham Aadi Vara" : track.title}.mp3`,
              ),
              tags: {
                ...emptyTags(),
                album: "Irayil Payanangalil",
                title: index === 1 ? "Vasantham Aadi Vara" : track.title,
              },
              original: emptyTags(),
              folderName: "Irayil Payanangalil",
              folderPath: "Synthetic/Irayil Payanangalil",
              sourceHandle: undefined,
            })),
          )
        }
      >
        Use Irayil tracks
      </button>
      <button
        onClick={() =>
          setRows(
            [
              "Idhaya Vaasal",
              "Meghamthaan",
              "Nalamo Ena",
              "Nenjam Paadum",
              "Munthaanai",
              "Kurudaana Kavingnanukku",
            ].map((title, index) => ({
              ...initial[0],
              id: "nenjil-" + index,
              file: new File([], `Nenjil Oru Raagam - 0${index + 1} - ${title}.mp3`),
              tags: { ...emptyTags(), album: "Nenjil Oru Raagam", title },
              original: emptyTags(),
              folderName: "Nenjil Oru Raagam",
              folderPath: "Synthetic/Nenjil Oru Raagam",
              sourceHandle: undefined,
            })),
          )
        }
      >
        Use Nenjil tracks
      </button>
      <button
        onClick={() =>
          setRows((previous) =>
            previous.map((file) => ({
              ...file,
              tags: {
                ...file.tags,
                album: "Aayusu Nooru",
                artist: "Old singer",
                albumArtist: "Old album artist",
                composer: "Old composer",
                year: "",
              },
            })),
          )
        }
      >
        Populate existing credits
      </button>
      <AlbumCoversDialog
        open={covers}
        onOpenChange={setCovers}
        files={rows}
        onSaved={({ row, file, cover }) => {
          setRows((previous) =>
            previous.map((f) =>
              f.id === row.id
                ? { ...f, file, tags: { ...f.tags, cover }, original: { ...f.original, cover } }
                : f,
            ),
          );
          setResult("Artwork saved");
        }}
      />
      <AlbumMetadataDialog
        open={metadata}
        onOpenChange={setMetadata}
        files={rows}
        onApply={(patches) => {
          fixture.applied = [...patches];
          setRows((previous) =>
            previous.map((f) =>
              patches.has(f.id) ? { ...f, tags: { ...f.tags, ...patches.get(f.id) } } : f,
            ),
          );
          setResult("Metadata staged");
        }}
      />
    </main>
  );
}
run()
  .then((rows) => createRoot(document.getElementById("root")!).render(<App rows={rows} />))
  .catch((error) => {
    fixture.testError = String(error);
    console.error(error);
  });
