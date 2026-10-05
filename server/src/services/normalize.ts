/**
 * Key used to detect duplicate words, applied to the foreign text and to the definition: case, surrounding and
 * repeated whitespace and Unicode composition are ignored. Kept free of imports so migrations can use it.
 */
export function normalizeForeign(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}
