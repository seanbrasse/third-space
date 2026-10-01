/** Keep transient transport loss from consuming an unbounded sequence gap. */
export class InputSequence {
  private context = "";
  private connected = false;
  private acknowledged = -1;
  private cursor = -1;
  observe(context: string, acknowledged: number, connected: boolean): boolean {
    const reset = context !== this.context || connected !== this.connected || acknowledged < this.acknowledged;
    if (reset) this.cursor = acknowledged;
    this.context = context;
    this.connected = connected;
    this.acknowledged = acknowledged;
    this.cursor = Math.max(this.cursor, acknowledged);
    return reset;
  }
  next(visible: boolean): number | null {
    if (!this.connected || !visible || this.cursor - this.acknowledged >= 128 ||
        this.cursor >= Number.MAX_SAFE_INTEGER) return null;
    return ++this.cursor;
  }
}
