export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export class FixedClock implements Clock {
  #current: Date;

  constructor(start: Date | string) {
    this.#current = new Date(start);
  }

  now(): Date {
    return new Date(this.#current);
  }

  set(value: Date | string): void {
    this.#current = new Date(value);
  }

  advanceHours(hours: number): void {
    this.#current = new Date(this.#current.getTime() + hours * 3_600_000);
  }
}
