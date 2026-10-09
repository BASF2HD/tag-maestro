import { detectFormat, mimeForFormat } from "./audio-formats";

export type PreviewTrack = {
  id: string;
  file: File;
  sourceHandle?: Pick<FileSystemFileHandle, "getFile">;
};
export type PreviewState = { id: string | null; playing: boolean; loading: boolean };
export type PreviewTimeline = { position: number; duration: number };
export const EMPTY_TIMELINE: PreviewTimeline = { position: 0, duration: 0 };

/** One streamed media element for the entire library; no whole-song decoding. */
export class AudioPreview {
  state: PreviewState = { id: null, playing: false, loading: false };
  private generation = 0;
  private url: string | null = null;
  private listeners: Array<[string, EventListener]> = [];
  private timeline: PreviewTimeline = EMPTY_TIMELINE;
  private timelineListeners = new Set<() => void>();
  private pendingFraction: number | null = null;
  getTimeline = () => this.timeline;
  subscribeTimeline = (listener: () => void) => {
    this.timelineListeners.add(listener);
    return () => {
      this.timelineListeners.delete(listener);
    };
  };

  constructor(
    private audio: HTMLAudioElement,
    private changed: (state: PreviewState) => void,
    private failed: (message: string) => void,
  ) {
    audio.preload = "none";
    for (const event of ["loadedmetadata", "durationchange"]) {
      this.listen(event, () => {
        this.applyPendingSeek();
        this.publishTimeline();
      });
    }
    for (const event of ["timeupdate", "seeked"]) {
      this.listen(event, () => this.publishTimeline());
    }
    this.listen("playing", () => {
      if (this.state.id) this.update({ ...this.state, playing: true, loading: false });
    });
    this.listen("pause", () => {
      if (this.state.id && !this.state.loading) this.update({ ...this.state, playing: false });
    });
    this.listen("ended", () => {
      this.update({ ...this.state, playing: false, loading: false });
      this.publishTimeline();
    });
    this.listen("error", () => {
      if (!this.state.id || !audio.error) return;
      this.fail(
        "This browser cannot preview this file/codec, or the file is damaged. The original audio has not been changed.",
      );
    });
  }

  private listen(name: string, callback: EventListener) {
    this.audio.addEventListener(name, callback);
    this.listeners.push([name, callback]);
  }

  private update(state: PreviewState) {
    this.state = state;
    this.changed(state);
  }

  private fail(message: string) {
    this.stop();
    this.failed(message);
  }

  private publishTimeline() {
    const duration =
      this.state.id && Number.isFinite(this.audio.duration) && this.audio.duration > 0
        ? this.audio.duration
        : 0;
    const position =
      duration && Number.isFinite(this.audio.currentTime)
        ? Math.min(duration, Math.max(0, this.audio.currentTime))
        : 0;
    if (duration === this.timeline.duration && position === this.timeline.position) return;
    this.timeline = { position, duration };
    this.timelineListeners.forEach((listener) => listener());
  }

  private applyPendingSeek() {
    if (
      !this.state.id ||
      this.pendingFraction === null ||
      !Number.isFinite(this.audio.duration) ||
      this.audio.duration <= 0
    )
      return;
    this.audio.currentTime = this.pendingFraction * this.audio.duration;
    this.pendingFraction = null;
  }

  /** Seeking never resumes a paused song or changes the original file. */
  seek(seconds: number) {
    if (
      !this.state.id ||
      !Number.isFinite(seconds) ||
      !Number.isFinite(this.audio.duration) ||
      this.audio.duration <= 0
    )
      return;
    this.pendingFraction = null;
    this.audio.currentTime = Math.min(this.audio.duration, Math.max(0, seconds));
    this.publishTimeline();
  }

  /** An inactive row can start at a chosen point once its metadata is available. */
  async seekFraction(track: PreviewTrack, fraction: number) {
    if (!Number.isFinite(fraction)) return;
    const value = Math.min(1, Math.max(0, fraction));
    if (this.state.id !== track.id) {
      await this.start(track, value);
    } else if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
      this.seek(value * this.audio.duration);
    } else {
      this.pendingFraction = value;
    }
  }

  async toggle(track: PreviewTrack): Promise<void> {
    if (this.state.id === track.id && this.state.loading) {
      this.stop();
      return;
    }
    if (this.state.id === track.id && !this.audio.paused) {
      this.audio.pause();
      return;
    }
    await this.start(track);
  }

  private async start(track: PreviewTrack, fraction: number | null = null): Promise<void> {
    if (this.state.id !== track.id) {
      this.stop();
      const generation = this.generation;
      this.pendingFraction = fraction;
      this.update({ id: track.id, playing: false, loading: true });
      try {
        const file = track.sourceHandle ? await track.sourceHandle.getFile() : track.file;
        if (generation !== this.generation) return;
        // Picked files often have an empty/generic MIME type. Only wrap; never encode.
        const blob = new Blob([file], { type: mimeForFormat(detectFormat(file)) });
        this.url = URL.createObjectURL(blob);
        this.audio.src = this.url;
      } catch (error) {
        if (generation === this.generation) this.fail(`Cannot open preview: ${messageOf(error)}`);
        return;
      }
    }
    const generation = this.generation;
    this.update({ ...this.state, loading: true });
    if (this.audio.ended) this.audio.currentTime = 0;
    try {
      await this.audio.play();
      if (generation === this.generation) {
        this.applyPendingSeek();
        this.publishTimeline();
        this.update({ ...this.state, playing: true, loading: false });
      }
    } catch (error) {
      if (generation !== this.generation) return;
      if ((error as { name?: string })?.name === "NotAllowedError") {
        this.update({ ...this.state, playing: false, loading: false });
        this.failed("Preview was blocked by the browser. Allow sound and press Play again.");
      } else {
        this.fail(
          `Cannot preview this file/codec in this browser: ${messageOf(error)}. Original audio is unchanged.`,
        );
      }
    }
  }

  stop() {
    this.generation += 1;
    this.pendingFraction = null;
    this.update({ id: null, playing: false, loading: false });
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.publishTimeline();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }

  destroy() {
    for (const [name, listener] of this.listeners) this.audio.removeEventListener(name, listener);
    this.listeners = [];
    this.stop();
    this.timelineListeners.clear();
  }
}

export function previewNeighbours<T extends { id: string }>(
  tracks: T[],
  id: string | undefined | null,
) {
  const index = tracks.findIndex((track) => track.id === id);
  return {
    previous: index > 0 ? tracks[index - 1] : undefined,
    next: index >= 0 && index < tracks.length - 1 ? tracks[index + 1] : undefined,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
