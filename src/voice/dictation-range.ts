/** A dictation owns one captured range. Concurrent edits revoke that ownership. */
export class DictationRange {
  private expected: string;
  private prefix: string;
  private suffix: string;
  constructor(value: string, start: number, end: number) {
    this.expected = value;
    this.prefix = value.slice(0, start);
    this.suffix = value.slice(end);
  }
  update(current: string, transcript: string): string | null {
    if (current !== this.expected) return null;
    this.expected = this.prefix + transcript + this.suffix;
    return this.expected;
  }
}
