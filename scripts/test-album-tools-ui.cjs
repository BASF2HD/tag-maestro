const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "tagmaestro-album-tools-"));
app.setPath("userData", temporary);
app.on("window-all-closed", () => {});
let server, window;
app
  .whenReady()
  .then(async () => {
    process.chdir(root);
    const { createServer } = await import("vite");
    server = await createServer({
      configFile: path.join(root, "scripts/test-song-actions.config.ts"),
      cacheDir: path.join(temporary, "cache"),
      server: { host: "127.0.0.1", port: 0, strictPort: false, open: false },
    });
    await server.listen();
    window = new BrowserWindow({
      show: false,
      width: 1180,
      height: 860,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    const errors = [];
    window.webContents.on("console-message", (_event, level, message) => {
      if (level >= 3) errors.push(message);
    });
    const evaluate = (expression) => window.webContents.executeJavaScript(expression);
    const wait = async (expression, description) => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return;
        const error = await evaluate("window.testError");
        if (error) throw new Error(error);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Timed out: " + description + " " + errors.join("; "));
    };
    const click = async (text) => {
      assert(
        await evaluate(
          `(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled);button?.click();return Boolean(button);})()`,
        ),
        "Missing button " + text,
      );
      await new Promise((resolve) => setTimeout(resolve, 80));
    };
    const label = async (text) => {
      assert(
        await evaluate(
          `(()=>{const label=[...document.querySelectorAll('label')].find(b=>b.textContent.includes(${JSON.stringify(text)}));label?.click();return Boolean(label);})()`,
        ),
        "Missing label " + text,
      );
      await new Promise((resolve) => setTimeout(resolve, 80));
    };
    await window.loadURL(
      `http://127.0.0.1:${server.httpServer.address().port}/scripts/test-album-tools.html`,
    );
    await wait("window.ready", "synthetic tests");
    console.log(await evaluate("window.unitResult"));
    const liveFile = process.argv
      .find((value) => value.startsWith("--wiki-fixture="))
      ?.slice("--wiki-fixture=".length);
    if (liveFile) {
      const json = JSON.parse(fs.readFileSync(liveFile, "utf8"));
      const live = await evaluate(
        `window.parseWikipedia(${JSON.stringify(json.parse.text["*"])},{name:'Aayusu Nooru',url:'https://en.wikipedia.org/wiki/Aayusu_Nooru',id:'Aayusu Nooru'})`,
      );
      assert.equal(live.values.composer, "T. Rajendar");
      assert.equal(live.values.year, "1987");
      assert.equal(live.tracks.length, 5);
      assert(live.tracks[0].artist.includes("S. Janaki"));
      console.log(
        "PASS: live Wikipedia example credits parsed: composer, year and five song/singer entries.",
      );
    }
    const appleFile = process.argv
      .find((value) => value.startsWith("--apple-fixture="))
      ?.slice("--apple-fixture=".length);
    if (appleFile) {
      const json = JSON.parse(fs.readFileSync(appleFile, "utf8"));
      const wiki = liveFile
        ? JSON.parse(fs.readFileSync(liveFile, "utf8")).parse.text["*"]
        : undefined;
      const result = await evaluate(
        `window.validateApple(${JSON.stringify(json)},${JSON.stringify(wiki)})`,
      );
      assert.equal(result.tracks, 5);
      assert.equal(result.matchedSongs, 5);
      console.log(
        "PASS: real Apple example found with alternate album/song spellings and all five singer credits.",
      );
    }
    const pagesFile = process.argv
      .find((value) => value.startsWith("--page-fixtures="))
      ?.slice("--page-fixtures=".length);
    if (pagesFile) {
      const pages = JSON.parse(fs.readFileSync(pagesFile, "utf8"));
      const result = await evaluate(
        `window.validatePublicPages(${JSON.stringify(pages.jio)},${JSON.stringify(pages.spotify)},${JSON.stringify(pages.apple)})`,
      );
      assert.equal(result.tracks, 6);
      console.log(
        "PASS: actual JioSaavn and Spotify public pages expose six tracks with per-song artists; JioSaavn explicit composer credit parsed.",
      );
    }
    const vasanthaFile = process.argv
      .find((value) => value.startsWith("--vasantha-fixture="))
      ?.slice("--vasantha-fixture=".length);
    if (vasanthaFile) {
      const response = JSON.parse(fs.readFileSync(vasanthaFile, "utf8"));
      const result = await evaluate(`window.validateVasantha(${JSON.stringify(response)})`);
      assert.equal(result.tracks, 5);
      console.log(
        "PASS: actual Vasantha Azhaippugal page: five singer credits, alternate title spellings, Apple priority and explicit page preference with existing-tag protection.",
      );
    }
    const deezerFile = process.argv
      .find((value) => value.startsWith("--deezer-fixtures="))
      ?.slice("--deezer-fixtures=".length);
    if (deezerFile) {
      const data = JSON.parse(fs.readFileSync(deezerFile, "utf8"));
      const result = await evaluate(
        `window.validateDeezer(${JSON.stringify(data.deezer)},${JSON.stringify(data.spotify)})`,
      );
      assert.equal(result.tracks, 6);
      console.log(
        "PASS: Deezer six-track credits and word-level Aadi/Paadi/Padi matching, distinct Female/Male variants and explicit manual selection.",
      );
    }
    await evaluate(
      `document.querySelector('img[alt="Editor artwork fixture"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`,
    );
    await wait(
      "document.body.textContent.includes('2048 × 1200 pixels')",
      "original image dimensions",
    );
    assert.equal(
      await evaluate(
        "document.querySelector('img[alt=\"Full-resolution cover artwork\"]').src===window.largeCover",
      ),
      true,
      "Viewer must use original image bytes",
    );
    await click("Actual size (100%)");
    assert.equal(
      await evaluate(
        "document.querySelector('img[alt=\"Full-resolution cover artwork\"]').getBoundingClientRect().width",
      ),
      2048,
      "100% view was resized",
    );
    await click("Fit to window");
    await click("Close image");
    await click("Open covers");
    const buttonStyles = await evaluate(
      `(()=>[...document.querySelectorAll('[role="dialog"] button')].filter(button=>!button.getAttribute('aria-label')?.includes('Close dialog')).map(button=>({font:getComputedStyle(button).fontSize,height:button.getBoundingClientRect().height})))()`,
    );
    assert(
      buttonStyles.every((style) => style.font === "12px" && style.height === 32),
      "Cover dialog controls use inconsistent sizes: " + JSON.stringify(buttonStyles),
    );
    await click("Scan folders");
    await wait("document.body.textContent.includes('Scanned 1 albums')", "cover scan");
    await click("Preview");
    await wait(
      "Boolean(document.querySelector('img[alt=\"Selected front image\"]'))",
      "front preview",
    );
    await click("Replace front artwork & save (2 tracks)");
    await wait(
      "document.body.textContent.includes('2 tracks saved and verified; 0 failed')",
      "verified batch save",
    );
    await click("Close");
    await click("Open metadata");
    await click("Look up selected albums (1)");
    await wait("document.body.textContent.includes('Lookup complete')", "album lookup");
    assert.equal(
      await evaluate("window.calls.filter(c=>c.provider==='apple').length"),
      2,
      "Apple requests should be per album, not per song",
    );
    assert.equal(
      await evaluate("window.calls.some(c=>c.provider==='spotify')"),
      false,
      "Unconfigured Spotify should be skipped",
    );
    assert(
      await evaluate("document.body.textContent.includes('Composer Name')"),
      "Missing composer proposal",
    );
    assert(
      await evaluate(
        "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('changes to editor')).disabled",
      ),
      "Apply should require review",
    );
    assert.equal(
      await evaluate("window.applied"),
      undefined,
      "Lookup applied changes without review",
    );
    await label("I reviewed the source editions");
    assert(
      await evaluate(
        "(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('changes to editor'));if(!b||b.disabled)return false;b.click();return true;})()",
      ),
      "Apply did not enable after review",
    );
    await wait("document.body.textContent.includes('Metadata staged')", "staged metadata");
    assert(
      await evaluate(
        "window.applied.length===2&&window.applied.every(([,p])=>p.composer==='Composer Name'&&p.artist.startsWith('Apple Singer'))",
      ),
      "Staged patches incorrect",
    );
    await evaluate(
      `(()=>{const field=document.querySelector('input[aria-label="Album search text"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'https://music.apple.com/gb/album/aayasu-nooru/123?i=456');field.dispatchEvent(new Event('input',{bubbles:true}));window.calls=[];})()`,
    );
    await click("Search album");
    await wait("document.body.textContent.includes('Lookup complete')", "direct Apple album link");
    assert(
      await evaluate(
        "window.calls.some(call=>call.provider==='apple'&&call.action==='details'&&call.url.includes('/gb/album/'))",
      ),
      "Apple URL was treated as a search query",
    );
    assert(
      !(await evaluate("window.calls.some(call=>call.provider==='apple'&&call.action==='search')")),
      "Apple link should bypass name search",
    );
    await evaluate(
      `(()=>{const field=document.querySelector('input[aria-label="Album web page URL"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'https://music.apple.com/au/album/aayasu-nooru/123');field.dispatchEvent(new Event('input',{bubbles:true}));window.calls=[];})()`,
    );
    await click("Load Apple album");
    await wait(
      "document.body.textContent.includes('Apple catalog album loaded from the supplied link')",
      "Apple link in webpage field",
    );
    assert(
      await evaluate(
        "window.calls.some(call=>call.provider==='apple'&&call.action==='details'&&call.url.includes('/au/album/'))",
      ),
      "Apple webpage link did not use Apple provider",
    );
    window.setSize(1000, 650);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert(
      await evaluate(
        "(()=>{const dialog=document.querySelector('[role=dialog]');const bounds=dialog.getBoundingClientRect();return bounds.top>=0&&bounds.bottom<=innerHeight+1;})()",
      ),
      "Dialog escaped compact viewport",
    );
    fs.writeFileSync(
      path.join(temporary, "metadata-review.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    await click("Close");
    await click("Open metadata");
    await evaluate("window.delay=true;window.calls=[]");
    await click("Look up selected albums (1)");
    await click("Stop lookup");
    await wait("document.body.textContent.includes('Lookup stopped')", "cancelled provider lookup");
    assert(
      (await evaluate("window.calls.length")) <= 1,
      "Stop continued to additional provider calls",
    );
    await click("Close");
    await click("Populate existing credits");
    await click("Open metadata");
    await click("Look up selected albums (1)");
    await wait(
      "document.body.textContent.includes('Lookup complete')",
      "metadata review with existing tags",
    );
    for (const field of ["artist", "albumArtist", "composer"]) {
      assert(
        await evaluate(
          `(()=>{const rows=[...document.querySelectorAll('tr[data-review-field="${field}"]')];return rows.length===2&&rows.every(row=>row.dataset.reviewStatus==='kept'&&row.children[2].textContent.trim()!=='Not available');})()`,
        ),
        "Fetched " + field + " hidden with overwrite off",
      );
    }
    assert.equal(
      await evaluate("document.querySelectorAll('tr[data-review-status=change]').length"),
      2,
      "Only empty years should be ready initially",
    );
    await label("Show only changes");
    assert.equal(
      await evaluate("document.querySelectorAll('tr[data-review-field]').length"),
      2,
      "Only-changes filter failed",
    );
    await label("Show only changes");
    assert.equal(
      await evaluate("document.querySelectorAll('tr[data-review-field]').length"),
      18,
      "All-fields review did not restore fetched credits",
    );
    window.setSize(1180, 860);
    await evaluate(
      "document.querySelector('[aria-label=\"Fetched album metadata\"]').scrollIntoView({block:'start'})",
    );
    fs.writeFileSync(
      path.join(temporary, "all-fetched-credits.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    await label("Replace existing values");
    assert(
      await evaluate(
        "[...document.querySelectorAll('tr[data-review-field=artist],tr[data-review-field=albumArtist],tr[data-review-field=composer]')].every(row=>row.dataset.reviewStatus==='change')",
      ),
      "Explicit overwrite did not enable fetched credits",
    );
    if (pagesFile) {
      await click("Close");
      await click("Use Nenjil tracks");
      await click("Open metadata");
      const setURL = async (value) => {
        await evaluate(
          `(()=>{const field=document.querySelector('input[aria-label="Album web page URL"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event('input',{bubbles:true}));})()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
      };
      await setURL("https://www.jiosaavn.com/album/nenjil-oru-raagam/v-a3CHXG-Zo_");
      await click("Load JioSaavn album");
      await wait(
        "document.body.textContent.includes('JioSaavn album loaded from the supplied link: 6 tracks')",
        "JioSaavn page loading",
      );
      assert(
        await evaluate(
          "[...document.querySelectorAll('tr[data-review-field=artist]')].length===6&&[...document.querySelectorAll('tr[data-review-field=artist]')].every(row=>row.children[2].textContent.trim()!=='Not available')",
        ),
        "JioSaavn artists not displayed",
      );
      await setURL("https://open.spotify.com/album/4M6G1spdcjW0IBfn2MmsrB");
      await click("Load Spotify album");
      await wait(
        "document.body.textContent.includes('Spotify album loaded from the supplied link: 6 tracks')",
        "public Spotify page loading",
      );
      assert(
        await evaluate(
          "[...document.querySelectorAll('tr[data-review-field=artist]')].some(row=>row.children[2].textContent.includes('P. Jayachandran'))",
        ),
        "Public Spotify singers not displayed",
      );
      assert(
        await evaluate(
          "[...document.querySelectorAll('tr[data-review-field=composer]')].every(row=>row.dataset.reviewStatus==='unavailable')",
        ),
        "Replacing a supplied page retained its stale composer credit",
      );
      await evaluate("window.delay=1100");
      await click("Look up selected albums (1)");
      await wait(
        "Boolean(document.querySelector('[aria-label=\"Album lookup progress\"] .animate-spin'))",
        "visible lookup spinner",
      );
      await wait(
        "document.querySelector('[aria-label=\"Album lookup progress\"]').textContent.includes('1s')",
        "elapsed lookup feedback",
      );
      assert(
        await evaluate(
          "document.querySelector('[aria-label=\"Album lookup progress\"]').textContent.includes('Waiting for album source response')",
        ),
        "Backend progress phase was not displayed",
      );
      fs.writeFileSync(
        path.join(temporary, "lookup-progress.png"),
        (await window.webContents.capturePage()).toPNG(),
      );
      await wait(
        "document.body.textContent.includes('Lookup complete')&&!document.querySelector('[aria-label=\"Album lookup progress\"] .animate-spin')",
        "completed provider progress",
      );
      assert.equal(
        await evaluate(
          "document.querySelector('[aria-label=\"Metadata sources checked\"]').getAttribute('aria-valuenow')",
        ),
        "4",
        "Supplied URL not included in bulk progress",
      );
      assert.equal(
        await evaluate(
          "document.querySelector('[aria-label=\"Metadata sources checked\"]').getAttribute('aria-valuemax')",
        ),
        "4",
      );
      assert(
        await evaluate(
          "[...document.querySelectorAll('tr[data-review-field=artist]')].every(row=>row.children[2].textContent.includes('T Rajendar'))",
        ),
        "Default Apple artist credit missing after combined lookup",
      );
      await label("Prefer this page for Artist / singers");
      assert(
        await evaluate(
          "[...document.querySelectorAll('tr[data-review-field=artist]')].some(row=>row.children[2].textContent.includes('P. Jayachandran'))",
        ),
        "Supplied-page singers did not override music-director track credit",
      );
      assert(
        await evaluate(
          "[...document.querySelectorAll('tr[data-review-field=albumArtist]')].every(row=>row.children[2].textContent.includes('T Rajendar'))",
        ),
        "Singer preference unexpectedly replaced album artist",
      );
      await evaluate("window.delay=false");
    }
    if (deezerFile) {
      await click("Close");
      await click("Use Irayil tracks");
      await click("Open metadata");
      const setURL = async (value) => {
        await evaluate(
          `(()=>{const field=document.querySelector('input[aria-label="Album web page URL"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event('input',{bubbles:true}));})()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
      };
      await setURL("https://www.deezer.com/en/album/172720832");
      await click("Load Deezer album");
      await wait(
        "document.body.textContent.includes('Deezer album loaded from the supplied link: 6 tracks')",
        "Deezer URL reader",
      );
      assert.equal(
        await evaluate(
          "document.querySelector('tr[data-review-file=\"irayil-1\"][data-review-field=artist]').dataset.reviewStatus",
        ),
        "unmatched",
        "Ambiguous version auto-assigned a singer",
      );
      const selectFemale = async () => {
        assert(
          await evaluate(
            `(()=>{const select=[...document.querySelectorAll('select[aria-label^="Match song for"]')].find(field=>field.getAttribute('aria-label').includes('Vasantham Aadi Vara.mp3'));const option=[...select.options].find(option=>option.textContent.includes('Female'));if(!option)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,option.value);select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`,
          ),
          "Missing Female version choice",
        );
        await new Promise((resolve) => setTimeout(resolve, 80));
      };
      await selectFemale();
      assert(
        await evaluate(
          "document.querySelector('tr[data-review-file=\"irayil-1\"][data-review-field=artist]').children[2].textContent.includes('Janaki')",
        ),
        "Deezer manual Female mapping failed",
      );
      await setURL("https://open.spotify.com/album/4wtVnqTPTYLJpxJ36d3UEe");
      await click("Load Spotify album");
      await wait(
        "document.body.textContent.includes('Spotify album loaded from the supplied link: 6 tracks')",
        "additional Spotify URL reader",
      );
      await selectFemale();
      assert(
        await evaluate(
          "document.querySelector('tr[data-review-file=\"irayil-1\"][data-review-field=artist]').children[2].textContent.includes('Janaki')",
        ),
        "Spotify manual Female mapping failed",
      );
      await evaluate(
        `(async()=>{const details=document.querySelector('select[aria-label="Song matching source"]').closest('details');let pane=details.parentElement;while(pane&&getComputedStyle(pane).overflowY!=='auto')pane=pane.parentElement;if(pane)pane.scrollTop+=details.getBoundingClientRect().top-pane.getBoundingClientRect().top;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));})()`,
      );
      assert(
        await evaluate(
          "document.querySelector('select[aria-label=\"Song matching source\"]').closest('details').open",
        ),
        "Song-matching choices are not visible",
      );
      fs.writeFileSync(
        path.join(temporary, "word-matching.png"),
        (await window.webContents.capturePage()).toPNG(),
      );
    }
    if (vasanthaFile) {
      await click("Close");
      await click("Use Vasantha tracks");
      await click("Open metadata");
      await evaluate(
        `(()=>{const box=[...document.querySelectorAll('label')].find(label=>label.textContent.includes('Replace existing values')).querySelector('input');if(box.checked)box.click();const input=document.querySelector('input[aria-label="Album web page URL"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'https://www.jiosaavn.com/album/vasantha-azhaippugal/rlxWdnd4oZA_');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await click("Load JioSaavn album");
      await wait(
        "document.body.textContent.includes('JioSaavn album loaded from the supplied link: 5 tracks')",
        "Vasantha supplied page",
      );
      assert(
        await evaluate(
          `document.querySelector('[aria-label="Supplied page artist credits"]').textContent.includes('5/5 local files matched')`,
        ),
      );
      assert(
        await evaluate(
          `document.querySelector('[aria-label="JioSaavn song artists"]').textContent.includes('P. Susheela')`,
        ),
      );
      await click("Use JioSaavn for Artist / singers");
      assert.equal(
        await evaluate(
          `document.querySelectorAll('tr[data-review-field="artist"][data-review-status="kept"]').length`,
        ),
        5,
      );
      assert(
        await evaluate(
          `document.querySelector('[aria-label="Supplied page artist credits"]').textContent.includes('5 existing Artist tags are protected')`,
        ),
      );
      await label("Replace existing values");
      assert.equal(
        await evaluate(
          `document.querySelectorAll('tr[data-review-field="artist"][data-review-status="change"]').length`,
        ),
        5,
      );
      await label("I reviewed the source editions");
      await evaluate(
        `(()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent.includes('changes to editor'));if(button.disabled)throw Error('Vasantha apply disabled');button.click();})()`,
      );
      await wait("window.applied.length===5", "Vasantha five singer patches");
      assert(
        await evaluate(
          `window.applied.find(([id])=>id==='vasantha-2')[1].artist.includes('P. Susheela')`,
        ),
      );
      await evaluate(
        `document.querySelector('[aria-label="Supplied page artist credits"]').scrollIntoView({block:'start'})`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      fs.writeFileSync(
        path.join(temporary, "jiosaavn-artists.png"),
        (await window.webContents.capturePage()).toPNG(),
      );
      console.log(
        "PASS: supplied page shows all five singer credits, enables page preference, explains protected tags and stages the correct five Artist updates after review.",
      );
    }
    await evaluate("window.serviceMissing=true;window.calls=[]");
    await click("Look up selected albums (1)");
    await wait(
      "Boolean(document.querySelector('[role=alert]'))",
      "missing background service guidance",
    );
    assert.equal(
      await evaluate("window.calls.length"),
      0,
      "Missing desktop service should stop lookup before provider calls",
    );
    assert(
      !(await evaluate("document.body.textContent.includes('No handler registered')")),
      "Raw IPC exception shown to user",
    );
    assert(
      !(await evaluate("document.body.textContent.includes('Lookup complete.')")),
      "Failed lookup reported success",
    );
    assert.equal(errors.length, 0, errors.join("; "));
    console.log(
      "PASS: native Electron original-size cover viewer, consistent controls, Apple links in both fields, service health, visible fetched/protected/missing credits, overwrite selection, review/staging and compact layout.",
    );
    console.log("Screenshot:", path.join(temporary, "all-fetched-credits.png"));
    window.destroy();
    await server.close();
    app.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    window?.destroy();
    await server?.close();
    app.exit(1);
  });
