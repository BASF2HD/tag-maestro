import { createServerFn } from "@tanstack/react-start";

const TEXT_MODEL = process.env.AI_TEXT_MODEL || "google/gemini-2.5-flash";
const IMAGE_MODEL = process.env.AI_IMAGE_MODEL || "google/gemini-2.5-flash-image";

function gatewayHeaders() {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) return null;
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

function gatewayUrl(path: string) {
  const base = process.env.AI_GATEWAY_URL?.replace(/\/+$/, "");
  if (!base) return null;
  return `${base}${path}`;
}

const TAG_KEYS = ["title", "artist", "album", "albumArtist", "year", "genre", "track", "comment"] as const;

type TagFields = Partial<Record<(typeof TAG_KEYS)[number], string>>;
type AiFailure = {
  ok: false;
  error: string;
  status?: number;
  requestId?: string;
  retryable: boolean;
};
type AiTagResult = { ok: true; tags: TagFields } | AiFailure;
type GatewayJsonResult = { ok: true; data: unknown } | AiFailure;

function assertRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object.");
  }
  return value as Record<string, unknown>;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}

function readStringRecord(value: unknown): Record<string, string> {
  const input = assertRecord(value);
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(input)) {
    if (typeof item !== "string") throw new Error(`${key} must be a string.`);
    out[key] = item;
  }
  return out;
}

function validateFilenameInput(input: unknown) {
  const record = assertRecord(input);
  return { filename: assertString(record.filename, "filename") };
}

function validateIdentifyInput(input: unknown) {
  const record = assertRecord(input);
  return {
    filename: assertString(record.filename, "filename"),
    current: record.current === undefined ? undefined : readStringRecord(record.current),
  };
}

function validateCleanupInput(input: unknown) {
  const record = assertRecord(input);
  return { tags: readStringRecord(record.tags) };
}

function validateCoverInput(input: unknown) {
  const record = assertRecord(input);
  return {
    title: record.title === undefined ? undefined : assertString(record.title, "title"),
    artist: record.artist === undefined ? undefined : assertString(record.artist, "artist"),
    album: record.album === undefined ? undefined : assertString(record.album, "album"),
    genre: record.genre === undefined ? undefined : assertString(record.genre, "genre"),
    mood: record.mood === undefined ? undefined : assertString(record.mood, "mood"),
  };
}

function failure(error: string, options: Partial<Omit<AiFailure, "ok" | "error">> = {}): AiFailure {
  return {
    ok: false,
    error,
    retryable: options.retryable ?? false,
    status: options.status,
    requestId: options.requestId,
  };
}

async function gatewayFailure(res: Response, label = "AI gateway"): Promise<AiFailure> {
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const requestId = body?.request_id || body?.requestId;

  if (!res.ok) {
    if (res.status === 429) {
      return failure("AI is rate-limited right now. Try again shortly or process fewer files at once.", {
        status: res.status,
        requestId,
        retryable: true,
      });
    }
    if (res.status === 402) {
      return failure("AI credits are exhausted. Add credits or upgrade to continue using AI tools.", {
        status: res.status,
        requestId,
      });
    }
  }
  const message = body?.message || body?.title || text || `${label} failed`;
  return failure(`${label} ${res.status}: ${message}`, {
    status: res.status,
    requestId,
    retryable: res.status >= 500,
  });
}

async function chatJson(system: string, user: string): Promise<GatewayJsonResult> {
  const headers = gatewayHeaders();
  const url = gatewayUrl("/chat/completions");
  if (!headers || !url) return failure("AI is not configured for this project.");

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: TEXT_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
  } catch {
    return failure("Could not reach AI. Check your connection and try again.", {
      retryable: true,
    });
  }
  if (!res.ok) return gatewayFailure(res);

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";
  try {
    return { ok: true, data: JSON.parse(content) };
  } catch {
    return { ok: true, data: {} };
  }
}

function parseTags(data: unknown): AiTagResult {
  try {
    const record = assertRecord(data);
    const tags: TagFields = {};
    for (const key of TAG_KEYS) {
      const value = record[key];
      if (value === undefined) continue;
      if (typeof value !== "string") return failure("AI returned tags in an unexpected format.");
      tags[key] = value;
    }
    return { ok: true, tags };
  } catch {
    return failure("AI returned tags in an unexpected format.");
  }
}

/** Parse a filename into ID3 tag fields. */
export const aiParseFilename = createServerFn({ method: "POST" })
  .validator(validateFilenameInput)
  .handler(async ({ data }) => {
    const out = await chatJson(
      "You extract music metadata from filenames. Reply with pure JSON keys: title, artist, album, track, year. Empty string if unknown. Do not guess year unless present. Strip extension and common separators.",
      `Filename: ${data.filename}`,
    );
    if (!out.ok) return out;
    return parseTags(out.data);
  });

/** Identify/fill missing tags from what we have. */
export const aiIdentify = createServerFn({ method: "POST" })
  .validator(validateIdentifyInput)
  .handler(async ({ data }) => {
    const known = JSON.stringify(data.current ?? {}, null, 2);
    const out = await chatJson(
      "You identify songs from partial metadata using your training knowledge. Reply JSON with keys: title, artist, album, albumArtist, year, genre, track. Fill missing/uncertain fields with your best inference; keep provided values unless clearly wrong. Return an empty string when you cannot make a confident inference.",
      `Filename: ${data.filename}\nCurrent tags:\n${known}`,
    );
    if (!out.ok) return out;
    return parseTags(out.data);
  });

/** Clean/normalize tag strings (title case, artist normalization). */
export const aiCleanup = createServerFn({ method: "POST" })
  .validator(validateCleanupInput)
  .handler(async ({ data }) => {
    const out = await chatJson(
      "You clean music tags: fix Title Case for titles/albums, normalize featured artist notation to 'feat.', fix common typos, standardize known artist names, strip stray brackets, keep year and track digits only. Reply JSON with the same keys.",
      JSON.stringify(data.tags, null, 2),
    );
    if (!out.ok) return out;
    return parseTags(out.data);
  });

/** Generate an album cover image (base64 data URL) via image gen. */
export const aiGenerateCover = createServerFn({ method: "POST" })
  .validator(validateCoverInput)
  .handler(async ({ data }) => {
    const headers = gatewayHeaders();
    const url = gatewayUrl("/images/generations");
    if (!headers || !url) return failure("AI is not configured for this project.");

    const prompt = `Album cover art, square, no text, professional music album artwork. Artist: ${data.artist || "unknown"}. Album: ${data.album || data.title || "single"}. Genre: ${data.genre || "any"}. Mood: ${data.mood || "fitting the title"}.`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: IMAGE_MODEL,
          messages: [{ role: "user", content: prompt }],
          modalities: ["image", "text"],
        }),
      });
    } catch {
      return failure("Could not reach AI. Check your connection and try again.", {
        retryable: true,
      });
    }
    if (!res.ok) return gatewayFailure(res, "Image generation");

    const data2 = await res.json();
    const msg = data2.choices?.[0]?.message;
    const imgUrl: string | undefined =
      msg?.images?.[0]?.image_url?.url ?? msg?.images?.[0]?.url ?? undefined;
    if (!imgUrl) return failure("AI did not return an image. Try again.", { retryable: true });
    return { ok: true, dataUrl: imgUrl };
  });
