import { Button } from "@/components/ui/button";
import {
  resolvedSourceTrack,
  SOURCE_LABELS,
  type AlbumMetadata,
  type MetadataReviewRow,
} from "@/lib/album-metadata";
import type { Mp3File } from "@/lib/mp3";

export function PageArtistReview({
  source,
  files,
  rows,
  allowNumbers,
  preferred,
  disabled,
  onPrefer,
}: {
  source: AlbumMetadata;
  files: Mp3File[];
  rows: MetadataReviewRow[];
  allowNumbers: boolean;
  preferred: boolean;
  disabled: boolean;
  onPrefer(): void;
}) {
  const artists = source.tracks.filter((track) => track.artist?.trim());
  const matched = files.filter((file) =>
    resolvedSourceTrack(file, source, allowNumbers)?.artist?.trim(),
  );
  const matchedIds = new Set(matched.map((file) => file.id));
  const otherSource = rows.filter(
    (row) =>
      row.field === "artist" && matchedIds.has(row.id) && row.url !== source.url && row.after,
  );
  const kept = rows.filter(
    (row) => row.field === "artist" && row.url === source.url && row.status === "kept",
  );
  const label = SOURCE_LABELS[source.provider];
  return (
    <div className="space-y-2" aria-label="Supplied page artist credits">
      <p className="font-medium">
        {label}: {artists.length} of {source.tracks.length} songs have artist credits ·{" "}
        {matched.length}/{files.length} local files matched
      </p>
      {otherSource.length > 0 && (
        <p role="status">
          {otherSource.length} matched files currently use Artist / singers from another source.
          Choose this page below to use its credits.
        </p>
      )}
      {matched.length < files.length && (
        <p>
          For unmatched files, choose the corresponding source song under{" "}
          <strong>Song matching</strong> below.
        </p>
      )}
      {kept.length > 0 && (
        <p role="status">
          {kept.length} existing Artist tags are protected. Enable{" "}
          <strong>Replace existing values</strong> above to update them.
        </p>
      )}
      {artists.length > 0 && (
        <Button size="sm" variant="outline" disabled={disabled || preferred} onClick={onPrefer}>
          {preferred ? `Using ${label} for Artist / singers` : `Use ${label} for Artist / singers`}
        </Button>
      )}
      <details>
        <summary className="cursor-pointer">
          View {label} song artists ({artists.length})
        </summary>
        <div className="max-h-48 overflow-auto mt-1">
          <table className="w-full text-left" aria-label={`${label} song artists`}>
            <thead>
              <tr className="border-b">
                <th className="p-1">Source song</th>
                <th className="p-1">Artist / singers</th>
              </tr>
            </thead>
            <tbody>
              {source.tracks.map((track, index) => (
                <tr key={index} className="border-b align-top">
                  <td className="p-1">
                    {track.track || index + 1}. {track.title}
                  </td>
                  <td className="p-1">{track.artist || "Not provided"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {source.notes.map((note) => (
        <p className="text-muted-foreground" key={note}>
          {note}
        </p>
      ))}
    </div>
  );
}
