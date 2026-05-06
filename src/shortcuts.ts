export type KeyChord = {
  key?: string;
  code?: string;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  meta?: boolean;
};

export function matchesChord(event: KeyboardEvent, chord: KeyChord): boolean {
  if (chord.key !== undefined && event.key !== chord.key) return false;
  if (chord.code !== undefined && event.code !== chord.code) return false;
  if (chord.shift !== undefined && event.shiftKey !== chord.shift) return false;
  if (chord.ctrl !== undefined && event.ctrlKey !== chord.ctrl) return false;
  if (chord.alt !== undefined && event.altKey !== chord.alt) return false;
  if (chord.meta !== undefined && event.metaKey !== chord.meta) return false;
  return true;
}

export function matchesAnyChord(event: KeyboardEvent, chords: KeyChord[] | undefined): boolean {
  if (!chords || !Array.isArray(chords) || chords.length === 0) return false;
  return chords.some((c) => c && typeof c === "object" && matchesChord(event, c));
}

