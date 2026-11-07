export function cleanMusicTitle(value: string): string;
export function normalizedTitle(value: string): string;
export function titleSimilarity(left: string, right: string): number;
export function albumSearchTerms(query: string): string[];
export function appleAlbumReference(value: string): { id: string; country: string } | undefined;
export function spotifyAlbumReference(value: string): { id: string; url: string } | undefined;
export function jiosaavnAlbumReference(value: string): { id: string; url: string } | undefined;
export function deezerAlbumReference(value: string): { id: string; url: string } | undefined;
export function songTitleParts(value: string): {
  core: string;
  words: string[];
  variants: string[];
};
export function conflictingSongVersions(left: string, right: string): boolean;
export function songTitleSimilarity(left: string, right: string): number;
