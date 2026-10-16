export interface RuntimeActivityOptions {
  begin?(): number;
  end?(token: number): Promise<void>;
  check?(token: number): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
}

export class RuntimeActivity {
  private foreground = true;
  private generation = 0;
  private serial: Promise<void> = Promise.resolve();
  private options: RuntimeActivityOptions;
  constructor(options: RuntimeActivityOptions) {this.options = options;}
  isForeground() {return this.foreground;}
  setForeground(foreground: boolean): Promise<void> {
    if (this.foreground === foreground) return this.serial;
    this.foreground = foreground;
    const generation = ++this.generation;
    let token: number | undefined;
    if (!foreground) {
      try {token = this.options.begin?.();} catch {}
    }
    const work = foreground
      ? this.serial.catch(() => undefined).then(async () => {if (this.foreground && generation === this.generation) await this.options.resume();})
      : this.options.pause().finally(async () => {if (token !== undefined) await this.options.end?.(token);});
    this.serial = work;
    return work;
  }
  async whileActive<T>(work: (check: () => void) => Promise<T>): Promise<T> {
    const token = this.options.begin?.();
    const check = () => {if (token !== undefined) this.options.check?.(token);};
    try {check(); return await work(check);} finally {if (token !== undefined) await this.options.end?.(token);}
  }
}
