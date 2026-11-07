const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { MetadataLookup, publicURL, publicAddress } = require("../desktop/metadata-lookup.cjs");
(async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "192.168.1.3",
    "::1",
    "::ffff:127.0.0.1",
    "fe80::1",
    "2001:db8::1",
  ])
    assert.equal(publicAddress(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
    assert.equal(publicAddress(address), true, address);
  for (const url of [
    "file:///etc/passwd",
    "http://example.com",
    "https://localhost/test",
    "https://user:pass@example.com",
    "https://example.com:22/",
  ])
    assert.throws(() => publicURL(url));
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), "tagmaestro-metadata-test-"));
  const requests = [];
  const transport = async (url, headers) => {
    requests.push({ url, headers });
    let value = {
      results: [
        {
          wrapperType: "collection",
          collectionId: 123,
          collectionName: new URL(url).searchParams.get("term") || "Aayusu Nooru",
        },
      ],
    };
    if (url.includes("/v1/albums/"))
      value = url.includes("/tracks")
        ? { items: [{ name: "Second" }], next: null }
        : {
            id: "0123456789012345678901",
            tracks: {
              items: [{ name: "First" }],
              next: "https://api.spotify.com/v1/albums/0123456789012345678901/tracks?offset=1",
            },
          };
    return { text: JSON.stringify(value), url };
  };
  try {
    const service = new MetadataLookup(cache, transport, 10);
    const input = {
      provider: "apple",
      action: "search",
      query: "Aayusu Nooru & music",
      country: "IN",
    };
    await service.request(input);
    await service.request(input);
    assert.equal(requests.length, 1, "Requests should be cached");
    assert.equal(new URL(requests[0].url).searchParams.get("term"), input.query);
    await assert.rejects(
      service.request({ provider: "spotify", action: "search", query: "Album" }),
      /access token/,
    );
    service.setSpotifyToken("test-session-secret");
    const result = await service.request({
      provider: "spotify",
      action: "details",
      id: "0123456789012345678901",
    });
    assert.equal(result.json.tracks.items.length, 2, "Spotify pagination was incomplete");
    assert.equal(requests[1].headers.Authorization, "Bearer test-session-secret");
    const secondProcess = new MetadataLookup(cache, async () => {
      throw new Error("Cache missed");
    });
    await secondProcess.request(input);
    for (const name of await fs.readdir(cache))
      assert.equal(
        (await fs.readFile(path.join(cache, name), "utf8")).includes("test-session-secret"),
        false,
        "Token leaked into disk cache",
      );
    const { titleSimilarity, appleAlbumReference, normalizedTitle } =
      await import("../shared/metadata-matching.mjs");
    assert(
      titleSimilarity("Aayusu Nooru", "Aayasu Nooru (Original Motion Picture Soundtrack) - EP") >
        0.85,
    );
    assert(titleSimilarity("Aavani Masathula", "Aavani Masathilla") > 0.84);
    assert.equal(
      normalizedTitle("Aayasu Nooru (Original Motion Picture Soundtrack) - EP"),
      normalizedTitle("Aayasu Nooru"),
    );
    assert.deepEqual(
      appleAlbumReference("https://music.apple.com/gb/album/example/1836809310?i=1836809312"),
      { id: "1836809310", country: "GB" },
    );
    for (const url of [
      "https://music.apple.com.evil.org/in/album/test/123",
      "https://music.apple.com/in/artist/test/123",
      "https://evil.org/in/album/test/123",
    ])
      assert.equal(appleAlbumReference(url), undefined);
    const fallbackCalls = [];
    const fallback = new MetadataLookup(
      undefined,
      async (url) => {
        fallbackCalls.push(url);
        const parsed = new URL(url),
          term = parsed.searchParams.get("term");
        const collection = {
          wrapperType: "collection",
          collectionId: 1836809310,
          collectionName: "Aayasu Nooru (Original Motion Picture Soundtrack) - EP",
          artistName: "T. Rajendar",
          trackCount: 5,
          releaseDate: "1987-01-16",
          collectionViewUrl: "https://music.apple.com/in/album/example/1836809310",
        };
        return {
          url,
          text: JSON.stringify({
            results: parsed.pathname === "/lookup" || term === "Nooru" ? [collection] : [],
          }),
        };
      },
      0,
    );
    const broader = await fallback.request({
      provider: "apple",
      action: "search",
      query: "Aayusu Nooru",
      country: "IN",
    });
    assert.equal(
      broader.json.results[0].collectionId,
      1836809310,
      "Transliterated Apple album not found",
    );
    assert.equal(fallbackCalls.length, 2, "Broadening should stop after a useful close match");
    assert.equal(new URL(fallbackCalls[1]).searchParams.get("term"), "Nooru");
    await fallback.request({
      provider: "apple",
      action: "details",
      url: "https://music.apple.com/gb/album/example/1836809310?i=1836809312",
      country: "IN",
    });
    assert.equal(
      new URL(fallbackCalls.at(-1)).searchParams.get("id"),
      "1836809310",
      "Song query parameter confused album ID",
    );
    assert.equal(
      new URL(fallbackCalls.at(-1)).searchParams.get("country"),
      "GB",
      "Linked store country lost",
    );
    await assert.rejects(
      fallback.request({
        provider: "apple",
        action: "details",
        url: "https://evil.org/in/album/example/123",
      }),
      /valid Apple Music/,
    );
    const pageRequests = [];
    const events = [];
    const pages = new MetadataLookup(
      undefined,
      async (url, headers) => {
        pageRequests.push({ url, headers });
        return { url, text: "<html>public album data</html>" };
      },
      0,
    );
    const publicPage = await pages.request(
      {
        provider: "web",
        action: "page",
        url: "https://open.spotify.com/album/4M6G1spdcjW0IBfn2MmsrB?si=tracking",
      },
      (event) => events.push(event),
    );
    assert(publicPage.supplementalHtml, "Public Spotify track listing missing");
    assert.equal(pageRequests[0].url, "https://open.spotify.com/album/4M6G1spdcjW0IBfn2MmsrB");
    assert.equal(
      pageRequests[1].url,
      "https://open.spotify.com/embed/album/4M6G1spdcjW0IBfn2MmsrB",
    );
    assert(
      pageRequests.every((request) => !request.headers.Authorization),
      "Public pages unexpectedly require credentials",
    );
    assert(
      events.some((event) => event.stage === "fetching"),
      "No request progress emitted",
    );
    await assert.rejects(
      pages.request({
        provider: "web",
        action: "page",
        url: "https://open.spotify.com/track/4M6G1spdcjW0IBfn2MmsrB",
      }),
      /album link/,
    );
    await pages.request({
      provider: "web",
      action: "page",
      url: "https://www.jiosaavn.com/album/nenjil-oru-raagam/v-a3CHXG-Zo_",
    });
    assert.equal(
      pageRequests.at(-1).url,
      "https://www.jiosaavn.com/album/nenjil-oru-raagam/v-a3CHXG-Zo_",
    );
    const { deezerAlbumReference } = await import("../shared/metadata-matching.mjs");
    assert.deepEqual(
      deezerAlbumReference("https://www.deezer.com/en/album/172720832?utm_source=test"),
      { id: "172720832", url: "https://www.deezer.com/en/album/172720832" },
    );
    assert.equal(deezerAlbumReference("https://deezer.com/fr/album/172720832")?.id, "172720832");
    for (const url of [
      "https://www.deezer.com.evil.org/en/album/42",
      "https://www.deezer.com/en/track/42",
      "http://www.deezer.com/en/album/42",
    ])
      assert.equal(deezerAlbumReference(url), undefined);
    const deezerRequests = [];
    const deezer = new MetadataLookup(
      undefined,
      async (url) => {
        deezerRequests.push(url);
        let json;
        if (url === "https://api.deezer.com/album/42")
          json = {
            id: 42,
            type: "album",
            title: "Fixture",
            nb_tracks: 2,
            tracks: {
              data: [{ id: 55, title: "First", artist: { name: "Primary" } }],
              next: "https://api.deezer.com/album/42/tracks?index=1",
            },
          };
        else if (url.includes("/album/42/tracks"))
          json = { data: [{ id: 56, title: "Second", artist: { name: "Second primary" } }] };
        else
          json = {
            id: Number(url.split("/").at(-1)),
            album: { id: 42 },
            track_position: url.endsWith("/55") ? 1 : 2,
            disk_number: 1,
            contributors: [
              { name: "Primary", role: "Main" },
              { name: "Guest", role: "Featured" },
              { name: "Composer", role: "Composer" },
            ],
          };
        return { url, text: JSON.stringify(json) };
      },
      0,
    );
    const deezerResult = await deezer.request({
      provider: "web",
      action: "page",
      url: "https://www.deezer.com/en/album/42",
    });
    assert.equal(deezerResult.json.tracks.data.length, 2, "Deezer pagination incomplete");
    assert.equal(
      deezerResult.json.tracks.data[0].contributors.length,
      3,
      "Deezer extended performer roles missing",
    );
    assert(
      deezerRequests.every((url) => url.startsWith("https://api.deezer.com/")),
      "Deezer metadata used an unexpected host",
    );
    await assert.rejects(
      deezer.request({
        provider: "web",
        action: "page",
        url: "https://www.deezer.com/en/track/42",
      }),
      /album link/,
    );
    const invalidDeezer = new MetadataLookup(
      undefined,
      async (url) => ({ url, text: JSON.stringify({ id: 99, type: "album" }) }),
      0,
    );
    await assert.rejects(
      invalidDeezer.request({
        provider: "web",
        action: "page",
        url: "https://www.deezer.com/album/42",
      }),
      /different album/,
    );
    service.setSpotifyToken("");
    await assert.rejects(
      service.request({ provider: "spotify", action: "details", id: "0123456789012345678901" }),
      /access token/,
    );
    for (const input of [
      { provider: "apple", action: "details", id: "../../private" },
      { provider: "spotify", action: "details", id: "bad" },
      { provider: "wikipedia", action: "search", query: "x".repeat(201) },
      { provider: "web", action: "page", url: "file:///secret" },
    ])
      await assert.rejects(service.request(input));
    assert.throws(() => service.setSpotifyToken("x\r\nBad: header"));
    console.log(
      "PASS: provider URLs, validation, Spotify pagination/auth, persistent cache, credential isolation.",
    );
  } finally {
    await fs.rm(cache, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
