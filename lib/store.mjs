import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class JsonStore {
  constructor(file, seed, validate = () => {}) {
    this.file = file;
    this.seed = structuredClone(seed);
    this.validate = validate;
    this.state = structuredClone(seed);
    this.queue = Promise.resolve();
  }

  async init() {
    await mkdir(dirname(this.file), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'));
      this.validate(parsed);
      this.state = structuredClone(parsed);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.validate(this.seed);
      await this.#persist(this.seed);
      this.state = structuredClone(this.seed);
    }
    return this;
  }

  snapshot() {
    return structuredClone(this.state);
  }

  async mutate(fn) {
    const operation = this.queue.then(async () => {
      const draft = structuredClone(this.state);
      const result = await fn(draft);
      this.validate(draft);
      await this.#persist(draft);
      this.state = structuredClone(draft);
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  async #persist(value) {
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(tmp, this.file);
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => {});
      throw error;
    }
  }
}
