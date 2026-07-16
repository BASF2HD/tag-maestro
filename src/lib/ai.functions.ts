import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

function gatewayHeaders() {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;
  return { "Lovable-API-Key": key, "Content-Type": "application/json" };
}

const TagShape = z.object({
  title: z.string().optional(),
  artist: z.string().optional(),
  album: z.string().optional(),
  albumArtist: z.string().optional(),
  year: z.string().optional(),
  genre: z.string().optional(),
  track: z.string().optional(),
  comment: z.string().optional(),
});

type TagFields = z.infer<typeof TagShape>;
type AiFailure = {
  ok: false;
  error: string;
  status?: number;
  requestId?: string;
  retryable: boolean;
};
type AiTagResult = { ok: true; tags: TagFields } | AiFailure;
type GatewayJsonResult = { ok: true; data: unknown } | AiFailure;

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
      return failure("Lovable AI is rate-limited right now. Try again shortly or process fewer files at once.", {
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
  if (!headers) return failure("Lovable AI is not configured for this project.");

  let res: Response;
  try {
    res = await fetch(`${GATEWAY}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
  } catch {
    return failure("Could not reach Lovable AI. Check your connection and try again.", {
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
  const parsed = TagShape.safeParse(data);
  if (!parsed.success) return failure("Lovable AI returned tags in an unexpected format.");
  return { ok: true, tags: parsed.data };
}

/** Parse a filename into ID3 tag fields. */
export const aiParseFilename = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ filename: z.string() }).parse(i))
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
  .inputValidator((i: unknown) =>
    z
      .object({
        filename: z.string(),
        current: z.record(z.string(), z.string()).optional(),
      })
      .parse(i),
  )
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
  .inputValidator((i: unknown) =>
    z.object({ tags: z.record(z.string(), z.string()) }).parse(i),
  )
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
  .inputValidator((i: unknown) =>
    z
      .object({
        title: z.string().optional(),
        artist: z.string().optional(),
        album: z.string().optional(),
        genre: z.string().optional(),
        mood: z.string().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    const headers = gatewayHeaders();
    if (!headers) return failure("Lovable AI is not configured for this project.");

    const prompt = `Album cover art, square, no text, professional music album artwork. Artist: ${data.artist || "unknown"}. Album: ${data.album || data.title || "single"}. Genre: ${data.genre || "any"}. Mood: ${data.mood || "fitting the title"}.`;
    let res: Response;
    try {
      res = await fetch(`${GATEWAY}/images/generations`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-image",
          messages: [{ role: "user", content: prompt }],
          modalities: ["image", "text"],
        }),
      });
    } catch {
      return failure("Could not reach Lovable AI. Check your connection and try again.", {
        retryable: true,
      });
    }
    if (!res.ok) return gatewayFailure(res, "Image generation");

    const data2 = await res.json();
    const msg = data2.choices?.[0]?.message;
    const imgUrl: string | undefined =
      msg?.images?.[0]?.image_url?.url ?? msg?.images?.[0]?.url ?? undefined;
    if (!imgUrl) return failure("Lovable AI did not return an image. Try again.", { retryable: true });
    return { ok: true, dataUrl: imgUrl };
  });