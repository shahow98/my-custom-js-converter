export interface SubConfig {
  mod: Array<Mod>;
}

export class Mod {
  name: string;
  path: string;
  constructor(name: string, path: string) {
    this.name = name;
    this.path = path;
  }
}