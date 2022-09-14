export default {
  encode: {
    file: "index.js",
    output: "coded.js",
    entry: "customEvent",
    ignoreMod: ["commonUtil"]
  },
  decode: {
    file: "coded.js",
    output: "decoded.js",
    mount: "customEvent"
  },
  baseDir: "",
  target: [""],
  customConfig: "config.json"
} as Config.MainConfig;

export namespace Config {
  export interface MainConfig {
    encode: EncodeConfig;
    decode: DecodeConfig;
    baseDir: string;
    target: string[];
    customConfig: string;
  }

  export interface SubConfig {
    mod: Array<Mod>;
    version: string;
  }

  export interface EncodeConfig {
    file: string;
    output: string;
    entry: string;
    ignoreMod: string[];
  }

  export interface DecodeConfig {
    file: string;
    output: string;
    mount: string;
  }

  export class Mod {
    name: string;
    path: string;
    constructor(name: string, path: string) {
      this.name = name;
      this.path = path;
    }
  }
}
