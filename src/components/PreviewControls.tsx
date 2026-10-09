import React, { memo, useState, useSyncExternalStore } from "react";
import {
  AudioPreview,
  EMPTY_TIMELINE,
  previewNeighbours,
  type PreviewState,
} from "@/lib/audio-preview";
import type { Mp3File } from "@/lib/mp3";
import { ChevronLeft, ChevronRight, Loader2, Pause, Play, Trash2 } from "@/components/icons";

const noSubscription = () => () => {};
const emptyTimeline = () => EMPTY_TIMELINE;
function useTimeline(player: AudioPreview | null, active = true) {
  return useSyncExternalStore(
    active && player ? player.subscribeTimeline : noSubscription,
    active && player ? player.getTimeline : emptyTimeline,
    emptyTimeline,
  );
}

function timestamp(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(value % 60).padStart(2, "0")}`;
}

/** Only the active row subscribes to clock updates; the full table stays still. */
export const RowSeekControl = memo(function RowSeekControl({
  player,
  file,
  active,
  disabled,
}: {
  player: AudioPreview | null;
  file: Mp3File;
  active: boolean;
  disabled: boolean;
}) {
  const timeline = useTimeline(player, active);
  const [draft, setDraft] = useState<number | null>(null);
  const percent = timeline.duration ? (timeline.position / timeline.duration) * 100 : 0;
  return (
    <input
      type="range"
      min={0}
      max={100}
      step={0.1}
      value={draft ?? percent}
      disabled={disabled || !player}
      aria-label={`Quick seek ${file.file.name}`}
      aria-valuetext={
        active && timeline.duration
          ? `${timestamp(timeline.position)} of ${timestamp(timeline.duration)}`
          : "Choose a point to start this song"
      }
      title={
        active
          ? `${timestamp(timeline.position)} / ${timestamp(timeline.duration)}`
          : "Jump to any part of this song and preview it"
      }
      className="h-4 w-[76px] shrink-0 cursor-pointer accent-primary disabled:cursor-default disabled:opacity-40"
      onPointerDown={(event) => {
        event.stopPropagation();
        setDraft(percent);
      }}
      onPointerUp={() => setDraft(null)}
      onPointerCancel={() => setDraft(null)}
      onKeyUp={() => setDraft(null)}
      onBlur={() => setDraft(null)}
      onChange={(event) => {
        const value = Number(event.currentTarget.value);
        setDraft(value);
        void player?.seekFraction(file, value / 100);
      }}
    />
  );
});

export function PreviewTransport({
  player,
  preview,
  tracks,
  activeTrack,
  selected,
  disabled,
  onPreview,
  onDelete,
  onDeleteSelected,
}: {
  player: AudioPreview | null;
  preview: PreviewState;
  tracks: Mp3File[];
  activeTrack?: Mp3File;
  selected: Set<string>;
  disabled: boolean;
  onPreview: (file: Mp3File) => void;
  onDelete: (id: string) => void;
  onDeleteSelected: () => void;
}) {
  const timeline = useTimeline(player);
  const [draft, setDraft] = useState<number | null>(null);
  const target = activeTrack || tracks.find((track) => selected.has(track.id)) || tracks[0];
  const { previous, next } = previewNeighbours(tracks, target?.id);
  const hasPreview = Boolean(activeTrack && preview.id === activeTrack.id);
  const canSeek = hasPreview && timeline.duration > 0 && !disabled;
  const position = draft === null ? timeline.position : (draft / 100) * timeline.duration;
  const playing = hasPreview && (preview.playing || preview.loading);
  const buttonClass =
    "grid h-7 w-7 shrink-0 place-items-center rounded-[4px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-35";
  return (
    <div
      aria-label="Song preview controls"
      role="group"
      className="flex h-10 shrink-0 items-center gap-1.5 border-t border-border bg-sidebar/40 px-3 text-xs"
    >
      <button
        type="button"
        aria-label="Previous song"
        title="Previous song in the current table order"
        className={buttonClass}
        disabled={disabled || !previous}
        onClick={() => previous && onPreview(previous)}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label={
          preview.loading && hasPreview
            ? "Cancel song preview"
            : playing
              ? "Pause song preview"
              : "Play song preview"
        }
        title={playing ? "Pause preview" : "Play preview"}
        className={`${buttonClass} text-primary`}
        disabled={disabled || !target}
        onClick={() => target && onPreview(target)}
      >
        {hasPreview && preview.loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : playing ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
      </button>
      <button
        type="button"
        aria-label="Next song"
        title="Next song in the current table order"
        className={buttonClass}
        disabled={disabled || !next}
        onClick={() => next && onPreview(next)}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Delete previewed song from disk"
        title={
          activeTrack
            ? `Permanently delete ${activeTrack.file.name} immediately (no undo)`
            : "Preview a song before deleting it"
        }
        className={`${buttonClass} hover:bg-destructive/10 hover:text-destructive`}
        disabled={disabled || !hasPreview}
        onClick={() => activeTrack && onDelete(activeTrack.id)}
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Delete selected"
        title={`Permanently delete ${selected.size} selected song file(s) immediately (no undo)`}
        className="flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-[4px] px-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-35"
        disabled={disabled || !selected.size}
        onClick={onDeleteSelected}
      >
        <Trash2 className="h-4 w-4" />
        <span aria-hidden="true" className="text-[10px] tabular-nums">
          {selected.size}
        </span>
      </button>
      <span
        className="min-w-0 max-w-48 flex-1 truncate text-muted-foreground"
        title={target?.meta.path || target?.file.name}
      >
        {target
          ? `${hasPreview ? "" : "Ready: "}${target.tags.title || target.file.name}`
          : "Choose a song to preview"}
      </span>
      <span
        className="w-10 shrink-0 text-right tabular-nums text-muted-foreground"
        aria-label="Playback position"
      >
        {timestamp(position)}
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={0.1}
        value={draft ?? (timeline.duration ? (timeline.position / timeline.duration) * 100 : 0)}
        disabled={!canSeek}
        aria-label="Seek song preview"
        aria-valuetext={`${timestamp(position)} of ${timestamp(timeline.duration)}`}
        className="h-5 min-w-12 flex-1 cursor-pointer accent-primary disabled:cursor-default disabled:opacity-40"
        onPointerDown={() =>
          setDraft(timeline.duration ? (timeline.position / timeline.duration) * 100 : 0)
        }
        onPointerUp={() => setDraft(null)}
        onPointerCancel={() => setDraft(null)}
        onKeyUp={() => setDraft(null)}
        onBlur={() => setDraft(null)}
        onChange={(event) => {
          const value = Number(event.currentTarget.value);
          setDraft(value);
          player?.seek((value / 100) * timeline.duration);
        }}
      />
      <span className="w-10 shrink-0 tabular-nums text-muted-foreground" aria-label="Song duration">
        {timestamp(timeline.duration)}
      </span>
    </div>
  );
}
