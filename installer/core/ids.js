import { randomUUID, randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I: read aloud over the phone

export const newRunId = () => randomUUID();

export function newSupportCode() {
  let s = "";
  for (let i = 0; i < 4; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `BP-${s}`;
}
