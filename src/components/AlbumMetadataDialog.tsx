import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PageArtistReview } from "@/components/PageArtistReview";
import { SongMatchReview } from "@/components/SongMatchReview";
import { Loader2 } from "@/components/icons";
import {
  metadataFromPage,
  linkedAlbumProvider,
  spotifyAlbumReference,
  jiosaavnAlbumReference,
} from "@/lib/album-page-metadata";
import { Input } from "@/components/ui/input";
import { albumGroups, type AlbumGroup } from "@/lib/album-groups";
import {
  METADATA_FIELDS,
  metadataErrorMessage,
  isMissingMetadataService,
  SOURCE_LABELS,
  candidatesFrom,
  catalogMetadata,
  changesToPatches,
  metadataReview,
  changesFromReview,
  type MetadataReviewStatus,
  likelyAlbumCandidate,
  corroborateAlbum,
  normalizedTitle,
  appleAlbumReference,
  type LookupRequest,
  wikipediaMetadata,
  type AlbumMetadata,
  type Candidate,
  type MetadataField,
  type Provider,
} from "@/lib/album-metadata";
import type { Mp3File, Mp3Tags } from "@/lib/mp3";

type SourceState = {
  candidates: Candidate[];
  chosen: string;
  data?: AlbumMetadata;
  error?: string;
  note?: string;
  origin?: "page";
};
type Entry = { sources: Partial<Record<Provider, SourceState>>; status?: string };
type Activity = {
  album: string;
  index: number;
  total: number;
  completedAlbums: number;
  done: number;
  steps: number;
  source: string;
  phase: string;
  startedAt: number;
};
const providerList: Provider[] = ["apple", "spotify", "wikipedia"];
export function AlbumMetadataDialog({
  open,
  onOpenChange,
  files,
  onApply,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  files: Mp3File[];
  onApply(patches: Map<string, Partial<Mp3Tags>>): void;
}) {
  const albums = useMemo(() => albumGroups(files), [files]);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState("");
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [country, setCountry] = useState("IN");
  const [token, setToken] = useState("");
  const [spotify, setSpotify] = useState(false);
  const [webURLs, setWebURLs] = useState<Record<string, string>>({});
  const [preferPageArtists, setPreferPageArtists] = useState<Record<string, boolean>>({});
  const [fields, setFields] = useState(new Set<MetadataField>(METADATA_FIELDS.map((f) => f.key)));
  const [overwrite, setOverwrite] = useState(false);
  const [numbers, setNumbers] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [onlyChanges, setOnlyChanges] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [serviceError, setServiceError] = useState("");
  const [activity, setActivity] = useState<Activity | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const activeRequest = useRef<string | null>(null);
  const cancelled = useRef(false);
  const api = window.tagMaestroDesktop;
  useEffect(
    () =>
      api?.onMetadataProgress?.((progress) => {
        if (progress.requestId === activeRequest.current && !cancelled.current)
          setActivity((previous) =>
            previous ? { ...previous, phase: progress.message } : previous,
          );
      }),
    [api],
  );
  useEffect(() => {
    if (!running || !activity) return;
    const tick = () => setElapsed(Math.floor((Date.now() - activity.startedAt) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [running, activity?.startedAt]);
  const requestMetadata = async (input: LookupRequest) => {
    const requestId = crypto.randomUUID();
    activeRequest.current = requestId;
    try {
      return await api!.lookupMetadata({ ...input, requestId });
    } finally {
      if (activeRequest.current === requestId) activeRequest.current = null;
    }
  };
  const startActivity = (group: AlbumGroup) => {
    setElapsed(0);
    setActivity({
      album: group.name,
      index: 1,
      total: 1,
      completedAlbums: 0,
      done: 0,
      steps: 1,
      source: "",
      phase: "Starting lookup…",
      startedAt: Date.now(),
    });
  };
  const pageURL = (group: AlbumGroup) => {
    const entered = queries[group.id]?.trim() || "";
    return (
      webURLs[group.id]?.trim() ||
      (/^https:\/\//i.test(entered) && !appleAlbumReference(entered) ? entered : "")
    );
  };

  useEffect(() => {
    if (open) {
      setEntries({});
      setSelected(new Set(albums.map((a) => a.id)));
      setActive(albums[0]?.id || "");
      setQueries({});
      setWebURLs({});
      setPreferPageArtists({});
      setReviewed(false);
      setOnlyChanges(false);
      setMessage("");
      setServiceError("");
      setActivity(null);
    } else setToken("");
  }, [open]);
  const album = albums.find((a) => a.id === active);
  const updateSource = (id: string, provider: Provider, value: SourceState) => {
    setEntries((previous) => ({
      ...previous,
      [id]: { ...previous[id], sources: { ...previous[id]?.sources, [provider]: value } },
    }));
    setReviewed(false);
  };
  const load = async (
    group: AlbumGroup,
    provider: Provider,
    candidate: Candidate,
    candidates: Candidate[],
    automatic = false,
  ) => {
    if (!api) throw new Error("Restart the desktop app to enable metadata lookup.");
    if (!automatic) startActivity(group);
    setActivity((previous) =>
      previous
        ? { ...previous, source: SOURCE_LABELS[provider], phase: "Loading album details…" }
        : previous,
    );
    updateSource(group.id, provider, { candidates, chosen: candidate.id });
    try {
      const result = await requestMetadata(
        candidate.page
          ? { provider: "web", action: "page", url: candidate.url, country }
          : {
              provider,
              action: "details",
              id: candidate.id,
              country,
              url:
                provider === "apple" && appleAlbumReference(candidate.url)
                  ? candidate.url
                  : undefined,
            },
      );
      if (cancelled.current) return;
      const data = candidate.page
        ? metadataFromPage(result, candidate.url)
        : provider === "wikipedia"
          ? wikipediaMetadata(result.json?.parse?.text?.["*"] || "", candidate)
          : catalogMetadata(provider as "apple" | "spotify", result.json, candidate);
      const entered = queries[group.id]?.trim() || group.query;
      const query = /^https:\/\//i.test(entered) ? group.query : entered;
      const spellingDiffers = normalizedTitle(candidate.name) !== normalizedTitle(query);
      if (spellingDiffers) {
        const evidence = corroborateAlbum(group, data);
        const note = `Similar album spelling: ${candidate.name}. ${evidence.matched}/${group.files.length} local song titles match${evidence.yearConflict ? "; release year differs" : ""}.`;
        if (automatic && !evidence.supported) {
          updateSource(group.id, provider, {
            candidates,
            chosen: candidate.id,
            note: `${note} Review this edition and click Load to confirm, or choose another match.`,
          });
          return;
        }
        data.notes.unshift(note);
      }
      updateSource(group.id, provider, {
        candidates,
        chosen: candidate.id,
        data,
        origin: candidate.page ? "page" : undefined,
      });
      if (!automatic)
        setActivity((previous) =>
          previous ? { ...previous, done: 1, completedAlbums: 1 } : previous,
        );
    } catch (error) {
      updateSource(group.id, provider, {
        candidates,
        chosen: candidate.id,
        error: metadataErrorMessage(error),
      });
    }
  };
  const readPage = async (group: AlbumGroup, url: string) => {
    const provider = linkedAlbumProvider(url) || "web";
    setActivity((previous) =>
      previous
        ? { ...previous, source: SOURCE_LABELS[provider], phase: "Reading album page…" }
        : previous,
    );
    setEntries((previous) => {
      const entry = previous[group.id];
      const sources = { ...entry?.sources };
      for (const key of Object.keys(sources) as Provider[])
        if (sources[key]?.origin === "page") delete sources[key];
      return { ...previous, [group.id]: { ...entry, sources } };
    });
    try {
      const result = await requestMetadata(
        provider === "apple"
          ? { provider: "apple", action: "details", url, country }
          : { provider: "web", action: "page", url, country },
      );
      if (cancelled.current) return false;
      const apple = appleAlbumReference(url);
      let data: AlbumMetadata;
      if (apple) {
        const candidate = candidatesFrom("apple", result.json).find(
          (candidate) => candidate.id === apple.id,
        );
        if (!candidate) throw new Error("Apple did not return this album for the linked country.");
        data = catalogMetadata("apple", result.json, candidate);
      } else data = metadataFromPage(result, url);
      const key = ["jiosaavn", "deezer"].includes(data.provider) ? "web" : data.provider;
      const reference = spotifyAlbumReference(data.url) || appleAlbumReference(data.url);
      const candidate: Candidate = {
        id: reference?.id || data.url,
        name: data.name,
        url: data.url,
        artist: data.values.albumArtist,
        year: data.values.year,
        page: data.provider !== "apple",
      };
      updateSource(group.id, key, {
        candidates: key === "web" ? [] : [candidate],
        chosen: key === "web" ? "" : candidate.id,
        data,
        origin: "page",
      });
      if (key !== "web")
        updateSource(group.id, "web", {
          candidates: [],
          chosen: "",
          note: `${SOURCE_LABELS[data.provider]} album loaded from the supplied link.`,
        });
      setMessage(
        `${SOURCE_LABELS[data.provider]} album loaded from the supplied link: ${data.tracks.length} tracks. Review the proposed changes.`,
      );
      return true;
    } catch (error) {
      updateSource(group.id, "web", {
        candidates: [],
        chosen: "",
        error: metadataErrorMessage(error),
      });
      setMessage(metadataErrorMessage(error));
      return false;
    }
  };
  const lookup = async (groups: AlbumGroup[]) => {
    if (!api?.lookupMetadata) {
      setMessage("Close and restart Tag Maestro to load the new desktop metadata service.");
      return;
    }
    cancelled.current = false;
    setRunning(true);
    setReviewed(false);
    setElapsed(0);
    setActivity({
      album: groups[0]?.name || "",
      index: 1,
      total: groups.length,
      completedAlbums: 0,
      done: 0,
      steps: groups.reduce((sum, group) => sum + providerList.length + (pageURL(group) ? 1 : 0), 0),
      source: "",
      phase: "Checking desktop service…",
      startedAt: Date.now(),
    });
    let completedSteps = 0;
    try {
      if (api.metadataStatus && !(await api.metadataStatus()).ready)
        throw new Error("The metadata service is not ready. Fully quit and reopen Tag Maestro.");
      setServiceError("");
      let successfulSources = 0;
      for (let index = 0; index < groups.length && !cancelled.current; index++) {
        const group = groups[index];
        setActivity((previous) =>
          previous ? { ...previous, album: group.name, index: index + 1 } : previous,
        );
        setEntries((previous) => ({ ...previous, [group.id]: { sources: {} } }));
        for (const provider of providerList) {
          if (cancelled.current) break;
          setMessage(
            `Album ${index + 1}/${groups.length}: ${group.name} — ${SOURCE_LABELS[provider]}`,
          );
          setActivity((previous) =>
            previous
              ? {
                  ...previous,
                  source: SOURCE_LABELS[provider],
                  phase: "Searching for matching album editions…",
                }
              : previous,
          );
          if (provider === "spotify" && !spotify) {
            updateSource(group.id, provider, {
              candidates: [],
              chosen: "",
              error:
                "API search skipped: no Spotify token. Pasted Spotify album links can still load public credits.",
            });
            completedSteps++;
            setActivity((previous) =>
              previous ? { ...previous, done: completedSteps } : previous,
            );
            continue;
          }
          try {
            const entered = queries[group.id]?.trim() || group.query;
            const linked = appleAlbumReference(entered);
            const query = /^https:\/\//i.test(entered) ? group.query : entered;
            const result = await requestMetadata(
              linked && provider === "apple"
                ? { provider, action: "details", url: entered, country }
                : {
                    provider,
                    action: "search",
                    query,
                    country,
                    artist:
                      group.files[0]?.tags.albumArtist ||
                      group.files[0]?.tags.composer ||
                      undefined,
                    trackTitles: group.files
                      .slice(0, 3)
                      .map(
                        (file) =>
                          file.tags.title ||
                          file.file.name
                            .replace(/\.[^.]+$/, "")
                            .split(/\s+-\s+/)
                            .slice(2)
                            .join(" - "),
                      )
                      .filter(Boolean),
                  },
            );
            if (cancelled.current) break;
            successfulSources++;
            const candidates = candidatesFrom(provider, result.json);
            if (linked && provider === "apple") {
              const candidate = candidates.find((candidate) => candidate.id === linked.id);
              if (!candidate)
                throw new Error("Apple did not return this album in the linked country store.");
              const data = catalogMetadata("apple", result.json, candidate);
              updateSource(group.id, provider, { candidates, chosen: candidate.id, data });
              continue;
            }
            const exact = likelyAlbumCandidate(candidates, query);
            updateSource(group.id, provider, {
              candidates,
              chosen: "",
              error: !candidates.length ? "No album results." : undefined,
            });
            if (exact) await load(group, provider, exact, candidates, true);
          } catch (error) {
            updateSource(group.id, provider, {
              candidates: [],
              chosen: "",
              error: metadataErrorMessage(error),
            });
            if (isMissingMetadataService(error)) {
              setServiceError(metadataErrorMessage(error));
              setMessage(metadataErrorMessage(error));
              return;
            }
          } finally {
            completedSteps++;
            setActivity((previous) =>
              previous ? { ...previous, done: completedSteps } : previous,
            );
          }
        }
        if (!cancelled.current && pageURL(group)) {
          if (await readPage(group, pageURL(group))) successfulSources++;
          completedSteps++;
          setActivity((previous) => (previous ? { ...previous, done: completedSteps } : previous));
        }
        if (!cancelled.current)
          setActivity((previous) =>
            previous ? { ...previous, completedAlbums: index + 1 } : previous,
          );
      }
      setMessage(
        cancelled.current
          ? "Lookup stopped. Completed results are available for review."
          : successfulSources
            ? "Lookup complete. Review the album editions, song matches and proposed changes before applying."
            : "Lookup failed: no metadata source responded. See the errors above.",
      );
    } catch (error) {
      setServiceError(metadataErrorMessage(error));
      setMessage("Lookup could not start.");
    } finally {
      setRunning(false);
    }
  };
  const reviewsByAlbum = useMemo(
    () =>
      new Map(
        albums.map((group) => {
          const sources = Object.values(entries[group.id]?.sources || {}).flatMap((source) =>
            source.data
              ? [
                  {
                    ...source.data,
                    preferredFields:
                      source.origin === "page" && preferPageArtists[group.id]
                        ? (["artist"] as MetadataField[])
                        : undefined,
                  },
                ]
              : [],
          );
          return [
            group.id,
            sources.length ? metadataReview(group, sources, fields, overwrite, numbers) : [],
          ];
        }),
      ),
    [albums, entries, fields, overwrite, numbers, preferPageArtists],
  );
  const proposals = (group: AlbumGroup) => changesFromReview(reviewsByAlbum.get(group.id) || []);
  const activeReview = album ? reviewsByAlbum.get(album.id) || [] : [];
  const visibleReview = onlyChanges
    ? activeReview.filter((row) => row.status === "change")
    : activeReview;
  const protectedCount = activeReview.filter((row) => row.status === "kept").length;
  const statusLabels: Record<MetadataReviewStatus, string> = {
    change: "Will update",
    unchanged: "Already matches",
    kept: "Existing value kept",
    disabled: "Field not selected",
    unavailable: "Not provided by sources",
    unmatched: "Song not matched",
  };
  const allChanges = albums.filter((a) => selected.has(a.id)).flatMap(proposals);
  const sourceLink = (url: string, label: string) => (
    <button
      className="underline text-primary text-xs text-left"
      onClick={async () => {
        try {
          await api?.openMetadataSource(url);
        } catch (error) {
          setMessage(metadataErrorMessage(error));
        }
      }}
    >
      {label} ↗
    </button>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!running) onOpenChange(value);
      }}
    >
      <DialogContent className="sm:max-w-6xl max-h-[94vh] h-[880px] flex flex-col overflow-hidden p-4 gap-3">
        <DialogHeader className="pr-8">
          <DialogTitle>Look up album metadata</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Priority: Apple catalog (iTunes) → Spotify → Wikipedia → supplied web page. Lower sources
          fill fields missing from higher sources. Singers are stored in Artist. Unavailable credits
          stay unchanged.
        </p>
        {activity && (
          <div
            className="shrink-0 rounded-md border bg-muted/30 p-2 text-xs space-y-1"
            role="status"
            aria-live="polite"
            aria-label="Album lookup progress"
          >
            <div className="flex items-center gap-2">
              {running && <Loader2 className="h-4 w-4 animate-spin shrink-0" />}
              <strong>
                {running
                  ? cancelled.current
                    ? "Stopping lookup…"
                    : "Looking up metadata…"
                  : cancelled.current
                    ? "Lookup stopped"
                    : "Lookup finished"}
              </strong>
              <span className="ml-auto">
                {activity.completedAlbums}/{activity.total} albums · {elapsed}s
              </span>
            </div>
            <p className="break-words">
              Album {activity.index}/{activity.total}: {activity.album}
              {activity.source ? ` · ${activity.source}` : ""}
            </p>
            <p className="text-muted-foreground break-words">
              {running && !cancelled.current ? activity.phase : message}
            </p>
            <div
              className="h-1.5 rounded-full bg-muted overflow-hidden"
              role="progressbar"
              aria-label="Metadata sources checked"
              aria-valuemin={0}
              aria-valuemax={activity.steps}
              aria-valuenow={activity.done}
            >
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${activity.steps ? (activity.done / activity.steps) * 100 : 0}%` }}
              />
            </div>
            <p className="text-muted-foreground">
              {activity.done}/{activity.steps} source checks finished
            </p>
          </div>
        )}
        {serviceError && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 p-2 text-xs text-destructive"
          >
            {serviceError}
          </p>
        )}
        <div className="flex flex-wrap gap-2 items-center text-xs">
          <label>
            Store country{" "}
            <select
              aria-label="Store country"
              className="h-8 bg-background border rounded px-2 ml-1 text-xs"
              disabled={running}
              value={country}
              onChange={(event) => {
                setCountry(event.target.value);
                setEntries({});
                setReviewed(false);
              }}
            >
              <option value="IN">India</option>
              <option value="GB">United Kingdom</option>
              <option value="US">United States</option>
              <option value="CA">Canada</option>
              <option value="SG">Singapore</option>
              <option value="MY">Malaysia</option>
            </select>
          </label>
          <Button
            size="sm"
            disabled={running || !selected.size}
            onClick={() => void lookup(albums.filter((a) => selected.has(a.id)))}
          >
            {running ? "Looking up albums…" : `Look up selected albums (${selected.size})`}
          </Button>
          <details>
            <summary className="cursor-pointer">
              Spotify access {spotify ? "configured" : "(optional)"}
            </summary>
            <div className="flex gap-2 py-2">
              <Input
                className="h-8 px-2 text-xs"
                aria-label="Spotify API access token"
                autoComplete="off"
                type="password"
                value={token}
                placeholder="API access token · session only"
                onChange={(event) => setToken(event.target.value)}
                disabled={running}
              />
              <Button
                size="sm"
                disabled={running || !api?.setSpotifyToken}
                onClick={async () => {
                  try {
                    setSpotify(await api!.setSpotifyToken(token));
                    setToken("");
                    setMessage(
                      token
                        ? "Spotify token set for this app session. Tokens expire; replace when needed."
                        : "Spotify token cleared.",
                    );
                  } catch (error) {
                    setMessage(metadataErrorMessage(error));
                  }
                }}
              >
                Set / clear token
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Use your own Spotify developer access token. It is held in memory, never saved.
            </p>
          </details>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {METADATA_FIELDS.map((field) => (
            <label key={field.key} className="flex gap-1 items-center">
              <input
                type="checkbox"
                disabled={running}
                checked={fields.has(field.key)}
                onChange={(event) => {
                  setFields((previous) => {
                    const next = new Set(previous);
                    if (event.target.checked) next.add(field.key);
                    else next.delete(field.key);
                    return next;
                  });
                  setReviewed(false);
                }}
              />
              {field.label}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-4 text-xs">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={overwrite}
              disabled={running}
              onChange={(event) => {
                setOverwrite(event.target.checked);
                setReviewed(false);
              }}
            />
            Replace existing values (otherwise fill empty tags)
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={numbers}
              disabled={running}
              onChange={(event) => {
                setNumbers(event.target.checked);
                setReviewed(false);
              }}
            />
            Also match by track/disc number when titles differ
          </label>
        </div>
        <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
          <div className="w-60 max-sm:w-36 shrink-0 border rounded flex flex-col min-h-0">
            <div className="flex gap-2 p-2 text-xs border-b">
              <button
                disabled={running}
                className="underline"
                onClick={() => {
                  setSelected(new Set(albums.map((a) => a.id)));
                  setReviewed(false);
                }}
              >
                Select all
              </button>
              <button
                disabled={running}
                className="underline"
                onClick={() => {
                  setSelected(new Set());
                  setReviewed(false);
                }}
              >
                Clear
              </button>
            </div>
            <div className="overflow-auto min-h-0">
              {albums.map((group) => (
                <div
                  className={`p-2 flex gap-2 border-b ${active === group.id ? "bg-accent" : ""}`}
                  key={group.id}
                >
                  <input
                    aria-label={`Include ${group.name}`}
                    type="checkbox"
                    checked={selected.has(group.id)}
                    disabled={running}
                    onChange={(event) => {
                      setSelected((previous) => {
                        const next = new Set(previous);
                        if (event.target.checked) next.add(group.id);
                        else next.delete(group.id);
                        return next;
                      });
                      setReviewed(false);
                    }}
                  />
                  <button className="text-left min-w-0 text-xs" onClick={() => setActive(group.id)}>
                    <span className="break-words">{group.name}</span>
                    <span className="block text-muted-foreground">
                      {group.files.length} tracks · {proposals(group).length} changes
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="min-w-0 flex-1 overflow-auto space-y-3 pr-1">
            {album && (
              <>
                <div className="flex gap-2">
                  <Input
                    className="h-8 px-2 text-xs"
                    aria-label="Album search text"
                    placeholder="Album title or Apple Music / Spotify / JioSaavn / Deezer album link"
                    value={queries[album.id] ?? album.query}
                    disabled={running}
                    onChange={(event) =>
                      setQueries((previous) => ({ ...previous, [album.id]: event.target.value }))
                    }
                  />
                  <Button size="sm" disabled={running} onClick={() => void lookup([album])}>
                    Search album
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Tamil titles can use different English spellings. Similar names are checked
                  against song titles and year. Paste an Apple Music, Spotify, JioSaavn or Deezer
                  album link to load that edition.
                </p>
                {providerList.map((provider) => {
                  const state = entries[album.id]?.sources[provider];
                  return (
                    <div key={provider} className="border rounded p-2 space-y-1 text-xs">
                      <div className="font-medium">{SOURCE_LABELS[provider]}</div>
                      {state?.candidates.length ? (
                        <div className="flex gap-2">
                          <select
                            aria-label={`${SOURCE_LABELS[provider]} album match`}
                            disabled={running}
                            className="h-8 bg-background border rounded px-2 text-xs min-w-0 flex-1"
                            value={state.chosen}
                            onChange={(event) =>
                              updateSource(album.id, provider, {
                                ...state,
                                chosen: event.target.value,
                                data: undefined,
                                error: undefined,
                              })
                            }
                          >
                            <option value="">Choose an edition or skip this source</option>
                            {state.candidates.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} · {c.artist || ""} · {c.year || ""}
                              </option>
                            ))}
                          </select>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={running || !state.chosen}
                            onClick={async () => {
                              cancelled.current = false;
                              setRunning(true);
                              try {
                                await load(
                                  album,
                                  provider,
                                  state.candidates.find((c) => c.id === state.chosen)!,
                                  state.candidates,
                                );
                              } finally {
                                setRunning(false);
                              }
                            }}
                          >
                            Load
                          </Button>
                        </div>
                      ) : (
                        <p className="text-muted-foreground">
                          {state?.error || "Run lookup to find album editions."}
                        </p>
                      )}
                      {Boolean(state?.candidates.length && state.error) && (
                        <p className="text-destructive">{state!.error}</p>
                      )}
                      {state?.note && <p className="text-muted-foreground">{state.note}</p>}
                      {state?.data && (
                        <>
                          <p>
                            {state.data.tracks.length} source tracks ·{" "}
                            {sourceLink(state.data.url, "Open source")}
                          </p>
                          {state.data.notes.map((note) => (
                            <p className="text-muted-foreground" key={note}>
                              {note}
                            </p>
                          ))}
                        </>
                      )}
                    </div>
                  );
                })}
                <div className="border rounded p-2 space-y-1 text-xs">
                  <p className="font-medium">Other album web page</p>
                  <div className="flex gap-2">
                    <Input
                      className="h-8 px-2 text-xs"
                      aria-label="Album web page URL"
                      type="url"
                      placeholder="https://… individual album page"
                      value={webURLs[album.id] || ""}
                      disabled={running}
                      onChange={(event) =>
                        setWebURLs((previous) => ({ ...previous, [album.id]: event.target.value }))
                      }
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={running || !webURLs[album.id]}
                      onClick={async () => {
                        cancelled.current = false;
                        setRunning(true);
                        setReviewed(false);
                        startActivity(album);
                        try {
                          await readPage(album, webURLs[album.id].trim());
                          setActivity((previous) =>
                            previous ? { ...previous, done: 1, completedAlbums: 1 } : previous,
                          );
                        } finally {
                          setRunning(false);
                        }
                      }}
                    >
                      {linkedAlbumProvider(webURLs[album.id] || "")
                        ? `Load ${linkedAlbumProvider(webURLs[album.id] || "") === "apple" ? "Apple" : SOURCE_LABELS[linkedAlbumProvider(webURLs[album.id] || "")!]} album`
                        : "Read page"}
                    </Button>
                  </div>
                  <p className="text-muted-foreground">
                    Apple Music, Spotify, JioSaavn and Deezer album links are supported. Other pages
                    need structured album credits. Public listings may omit some fields.
                  </p>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      disabled={running}
                      checked={Boolean(preferPageArtists[album.id])}
                      onChange={(event) => {
                        setPreferPageArtists((previous) => ({
                          ...previous,
                          [album.id]: event.target.checked,
                        }));
                        setReviewed(false);
                      }}
                    />
                    Prefer this page for Artist / singers
                  </label>
                  <p className="text-muted-foreground">
                    Use this when another source credits the music director instead of the track
                    performers. Other fields keep the normal source priority.
                  </p>
                  {entries[album.id]?.sources.web?.note && (
                    <p className="text-muted-foreground">{entries[album.id].sources.web!.note}</p>
                  )}
                  {entries[album.id]?.sources.web?.error && (
                    <p className="text-destructive">{entries[album.id].sources.web!.error}</p>
                  )}
                  {entries[album.id]?.sources.web?.data && (
                    <p>
                      {entries[album.id].sources.web!.data!.name} ·{" "}
                      {sourceLink(entries[album.id].sources.web!.data!.url, "Open source")}
                    </p>
                  )}
                </div>
                {Object.values(entries[album.id]?.sources || {})
                  .filter((state) => state.origin === "page" && state.data)
                  .map((state) => (
                    <div key={state.data!.url} className="border rounded p-2 text-xs">
                      <PageArtistReview
                        source={state.data!}
                        files={album.files}
                        rows={activeReview}
                        allowNumbers={numbers}
                        preferred={Boolean(preferPageArtists[album.id]) && fields.has("artist")}
                        disabled={running}
                        onPrefer={() => {
                          setPreferPageArtists((previous) => ({ ...previous, [album.id]: true }));
                          setFields((previous) => new Set([...previous, "artist"]));
                          setReviewed(false);
                        }}
                      />
                    </div>
                  ))}
                <SongMatchReview
                  key={album.id}
                  files={album.files}
                  allowNumbers={numbers}
                  disabled={running}
                  sources={Object.entries(entries[album.id]?.sources || {}).flatMap(
                    ([key, state]) =>
                      state.data
                        ? [
                            {
                              key: key as Provider,
                              data: state.data,
                              preferred: Boolean(
                                preferPageArtists[album.id] && state.origin === "page",
                              ),
                            },
                          ]
                        : [],
                  )}
                  onMatch={(key, fileId, index) => {
                    setEntries((previous) => {
                      const state = previous[album.id]?.sources[key];
                      if (!state?.data) return previous;
                      const trackMatches = { ...state.data.trackMatches };
                      if (index === undefined) delete trackMatches[fileId];
                      else trackMatches[fileId] = index;
                      return {
                        ...previous,
                        [album.id]: {
                          ...previous[album.id],
                          sources: {
                            ...previous[album.id].sources,
                            [key]: { ...state, data: { ...state.data, trackMatches } },
                          },
                        },
                      };
                    });
                    setReviewed(false);
                  }}
                />
                <div className="text-xs space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-medium">Metadata review · {album.name}</h3>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={onlyChanges}
                        onChange={(event) => setOnlyChanges(event.target.checked)}
                      />
                      Show only changes
                    </label>
                  </div>
                  <p className="text-muted-foreground">
                    All fetched fields are shown, including singers, album artist and composer.
                    Check fields above to choose what can be applied. Missing credits stay
                    unchanged; song fields need a unique title or spelling match.
                  </p>
                  {protectedCount > 0 && (
                    <div role="status" className="rounded-md border bg-muted/30 p-2">
                      {protectedCount} fetched values differ from existing tags and are being kept.
                      Enable <strong>Replace existing values</strong> above to apply the fetched
                      credits for the selected fields.
                    </div>
                  )}
                  {visibleReview.length ? (
                    <table
                      className="w-full text-left border-collapse"
                      aria-label="Fetched album metadata"
                    >
                      <thead>
                        <tr className="border-b">
                          <th className="p-1">Field</th>
                          <th className="p-1">Current tag</th>
                          <th className="p-1">Fetched value</th>
                          <th className="p-1">Status</th>
                          <th className="p-1">Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleReview.map((row, index) => (
                          <tr
                            key={`${row.id}-${row.field}`}
                            className="border-b align-top"
                            data-review-file={row.id}
                            data-review-field={row.field}
                            data-review-status={row.status}
                          >
                            <td className="p-1">
                              <span className="block break-all text-muted-foreground">
                                {index === 0 || visibleReview[index - 1].id !== row.id
                                  ? row.filename
                                  : ""}
                              </span>
                              <span className="font-medium">
                                {METADATA_FIELDS.find((field) => field.key === row.field)?.label}
                              </span>
                              {row.matchNote && (
                                <span className="block text-muted-foreground">{row.matchNote}</span>
                              )}
                            </td>
                            <td className="p-1 break-words text-muted-foreground">
                              {row.before || "(empty)"}
                            </td>
                            <td className="p-1 break-words">
                              {row.after ? (
                                <strong>{row.after}</strong>
                              ) : (
                                <span className="text-muted-foreground">
                                  {row.status === "unmatched"
                                    ? "Match the song first"
                                    : "Not available"}
                                </span>
                              )}
                            </td>
                            <td
                              className={`p-1 ${row.status === "change" ? "text-primary font-medium" : "text-muted-foreground"}`}
                            >
                              {statusLabels[row.status]}
                            </td>
                            <td className="p-1">
                              {row.source && row.url
                                ? sourceLink(row.url, SOURCE_LABELS[row.source])
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-muted-foreground">
                      {activeReview.length
                        ? "No changes to apply with the current settings. Turn off Show only changes to see all fetched credits."
                        : "Load a matching album source to review all metadata fields."}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <p role="status" className="text-xs break-words">
          {message}
        </p>
        <label className="flex gap-2 items-center text-xs">
          <input
            type="checkbox"
            disabled={running}
            checked={reviewed}
            onChange={(event) => setReviewed(event.target.checked)}
          />
          I reviewed the source editions and proposed changes for the selected albums.
        </label>
        <div className="flex gap-2 justify-end">
          {running ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                cancelled.current = true;
                setMessage("Stopping after the current request…");
              }}
            >
              Stop lookup
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button
                size="sm"
                disabled={!reviewed || !allChanges.length}
                onClick={() => {
                  onApply(changesToPatches(allChanges));
                  setReviewed(false);
                  setMessage(
                    `Applied ${allChanges.length} field changes to the editor. Use Save originals to write them to your music files.`,
                  );
                }}
              >
                Apply {allChanges.length} changes to editor
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
