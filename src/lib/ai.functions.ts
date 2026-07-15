import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

function gatewayHeaders() {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function chatJson(system: string, user: string): Promise<any> {
  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method: "POST",
    headers: gatewayHeaders(),
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI gateway ${res.status}: ${text}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content);
  } catch {
    return {};
  }
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

/** Parse a filename into ID3 tag fields. */
export const aiParseFilename = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ filename: z.string() }).parse(i))
  .handler(async ({ data }) => {
    const out = await chatJson(
      "You extract music metadata from filenames. Reply with pure JSON keys: title, artist, album, track, year. Empty string if unknown. Do not guess year unless present. Strip extension and common separators.",
      `Filename: ${data.filename}`,
    );
    return TagShape.parse(out);
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
    return TagShape.parse(out);
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
    return TagShape.parse(out);
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
    const prompt = `Album cover art, square, no text, professional music album artwork. Artist: ${data.artist || "unknown"}. Album: ${data.album || data.title || "single"}. Genre: ${data.genre || "any"}. Mood: ${data.mood || "fitting the title"}.`;
    const res = await fetch(`${GATEWAY}/images/generations`, {
      method: "POST",
      headers: gatewayHeaders(),
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Image gen ${res.status}: ${text}`);
    }
    const data2 = await res.json();
    const msg = data2.choices?.[0]?.message;
    const imgUrl: string | undefined =
      msg?.images?.[0]?.image_url?.url ?? msg?.images?.[0]?.url ?? undefined;
    if (!imgUrl) throw new Error("No image returned");
    return { dataUrl: imgUrl };
  });