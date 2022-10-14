export interface MainConfig {
  encode: EncodeConfig;
  decode: DecodeConfig;
  baseDir: string;
  target: string[];
  workDir: string;
  customConfig: string;
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