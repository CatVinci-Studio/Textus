export class SilenceStop {
  private lastVoice: number;
  private heard = false;
  constructor(private started: number) {
    this.lastVoice = started;
  }
  sample(now: number, rms: number): "speech" | "empty" | null {
    if (rms > 0.012) {
      this.heard = true;
      this.lastVoice = now;
    }
    if (this.heard && now - this.lastVoice >= 1500) return "speech";
    if (!this.heard && now - this.started >= 5000) return "empty";
    return null;
  }
}
