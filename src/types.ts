export type NoteId = number;

export interface NotePosition {
  x: number;
  y: number;
}

export interface Note {
  id: NoteId;
  title: string;
  body: string;
  links: NoteId[];
  position?: NotePosition;
}
