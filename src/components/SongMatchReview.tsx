import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  PROVIDERS,
  SOURCE_LABELS,
  fileTrackNumber,
  matchRemoteTrack,
  resolvedSourceTrack,
  trackMatchSuggestions,
  type AlbumMetadata,
  type Provider,
} from "@/lib/album-metadata";
import type { Mp3File } from "@/lib/mp3";

type MatchSource = { key: Provider; data: AlbumMetadata; preferred: boolean };
export function SongMatchReview({
  files,
  sources,
  allowNumbers,
  disabled,
  onMatch,
}: {
  files: Mp3File[];
  sources: MatchSource[];
  allowNumbers: boolean;
  disabled: boolean;
  onMatch(source: Provider, fileId: string, index: number | null | undefined): void;
}) {
  const [chosen, setChosen] = useState<Provider | "">("");
  const [filter, setFilter] = useState("");
  const ordered = [...sources]
    .filter((source) => source.data.tracks.length)
    .sort(
      (a, b) =>
        Number(b.preferred) - Number(a.preferred) ||
        PROVIDERS.indexOf(a.data.provider) - PROVIDERS.indexOf(b.data.provider),
    );
  const source = ordered.find((source) => source.key === chosen) || ordered[0];
  const matched = source
    ? files.filter((file) => resolvedSourceTrack(file, source.data, allowNumbers)).length
    : 0;
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (source && matched < files.length) setExpanded(true);
  }, [source?.key, source?.data.url, matched < files.length]);
  if (!source) return null;
  const visible = files
    .filter((file) =>
      `${file.file.name} ${file.tags.title}`.toLowerCase().includes(filter.toLowerCase()),
    )
    .slice(0, 100);
  return (
    <details
      className="rounded-md border p-2 text-xs space-y-2"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="cursor-pointer font-medium">
        Song matching · {matched}/{files.length} matched · {SOURCE_LABELS[source.data.provider]}
      </summary>
      <p className="text-muted-foreground">
        Word matching allows Tamil spelling differences. Female/Male and other versions remain
        distinct. When several versions fit, choose the correct source song. Choices apply to this
        source’s song credits; field/source preferences still control which tags will be updated.
      </p>
      <div className="flex flex-wrap gap-2">
        <label className="flex items-center gap-2">
          Source{" "}
          <select
            className="h-8 rounded border bg-background px-2 text-xs"
            aria-label="Song matching source"
            value={source.key}
            disabled={disabled}
            onChange={(event) => setChosen(event.target.value as Provider)}
          >
            {ordered.map((item) => (
              <option key={item.key} value={item.key}>
                {SOURCE_LABELS[item.data.provider]} · {item.data.name}
              </option>
            ))}
          </select>
        </label>
        <Input
          className="h-8 min-w-32 flex-1 px-2 text-xs"
          aria-label="Filter local songs to match"
          placeholder="Filter local filenames or titles"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      <div className="max-h-64 overflow-auto divide-y">
        {visible.map((file) => {
          const automatic = matchRemoteTrack(file, source.data.tracks, allowNumbers);
          const manual = Boolean(
            source.data.trackMatches && Object.hasOwn(source.data.trackMatches, file.id),
          );
          const value = manual
            ? source.data.trackMatches![file.id] === null
              ? "skip"
              : String(source.data.trackMatches![file.id])
            : "auto";
          const suggestions = trackMatchSuggestions(file, source.data.tracks);
          const options = suggestions.slice(0, 50);
          const selected = manual && value !== "skip" ? Number(value) : undefined;
          if (
            selected !== undefined &&
            !options.some((option) => option.index === selected) &&
            source.data.tracks[selected]
          )
            options.push({
              track: source.data.tracks[selected],
              index: selected,
              score: 0,
              versionConflict: false,
            });
          return (
            <div key={file.id} className="py-2 space-y-1">
              <p className="break-all font-medium">{file.file.name}</p>
              <p className="text-muted-foreground">
                {fileTrackNumber(file) ? `Track ${fileTrackNumber(file)} · ` : ""}
                {file.meta?.length ? `${file.meta.length} · ` : ""}
                {manual
                  ? value === "skip"
                    ? "Song credits from this source are not matched."
                    : `Selected: ${source.data.tracks[Number(value)]?.title}`
                  : automatic
                    ? `Automatic match: ${automatic.title}`
                    : "Needs a choice: similar titles or version information are ambiguous."}
              </p>
              <select
                className="h-8 w-full min-w-0 rounded border bg-background px-2 text-xs"
                aria-label={`Match song for ${file.file.name}`}
                value={value}
                disabled={disabled}
                onChange={(event) =>
                  onMatch(
                    source.key,
                    file.id,
                    event.target.value === "auto"
                      ? undefined
                      : event.target.value === "skip"
                        ? null
                        : Number(event.target.value),
                  )
                }
              >
                <option value="auto">
                  {automatic ? `Automatic — ${automatic.title}` : "Automatic — no certain match"}
                </option>
                <option value="skip">Do not match song credits from this source</option>
                {options.map((option) => (
                  <option key={option.index} value={option.index}>
                    {option.track.track ? `${option.track.track}. ` : ""}
                    {option.track.title}
                    {option.track.artist ? ` — ${option.track.artist}` : ""}
                    {option.versionConflict
                      ? " · different version"
                      : option.score >= 0.65
                        ? " · similar title"
                        : ""}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      {files.length > 100 && (
        <p className="text-muted-foreground">
          Showing up to 100 local songs. Filter to find another file; each selector lists up to 50
          closest source titles.
        </p>
      )}
    </details>
  );
}
