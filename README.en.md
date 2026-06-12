[中文](README.md)

# my-custom-js-converter

A Babel-based JavaScript code transformer that flattens and restores CommonJS module structures.

## Features

- **Encode** — Recursively scans `require()` dependencies, extracts used methods from each module, and flattens them into a single file with renamed methods (e.g., `helperMethod__util`).
- **Decode** — Reads the generated dependency map and restores the original module structure by re-inserting `require()` statements and reversing method renaming.
- **Tree-shaking** — Only methods that are actually used are included in the encoded output; unused methods are stripped.
- **Configurable** — Entry object name, file names, ignore list, and scan directories are all configurable via `config.json`.

## Installation

```bash
npm install @kezh/my-custom-js-converter
# or
pnpm add @kezh/my-custom-js-converter
```

## Usage

### 1. Create a config file

Create `config.json` in your project root:

```json
{
  "encode": {
    "file": "index.js",
    "output": "coded.js",
    "entry": "customEvent",
    "ignoreMod": ["commonUtil"]
  },
  "decode": {
    "file": "coded.js",
    "output": "decoded.js",
    "mount": "customEvent"
  },
  "target": ["src"],
  "settingDir": ".setting"
}
```

#### Config Options

| Field | Description |
|---|---|
| `encode.file` | Source file name to encode |
| `encode.output` | Encoded output file name |
| `encode.entry` | Entry object name in source |
| `encode.ignoreMod` | Module names to skip during encoding |
| `decode.file` | Encoded file to decode |
| `decode.output` | Decoded output file name |
| `decode.mount` | Object name to mount decoded code |
| `target` | Directories to scan (relative to project root) |
| `settingDir` | Directory for the dependency map file |

### 2. Encode

```bash
npx encode
```

Scans the `target` directories for files matching `encode.file`, builds a dependency map, and outputs:
- `encode.output` — the flattened code file
- `settingDir/mod.map` — the dependency map (needed for decoding)

### 3. Decode

```bash
npx decode
```

Reads the dependency map from `settingDir/mod.map`, restores `require()` imports, reverses method renaming, and outputs `decode.output`.

## How It Works

### Encode Flow

```
index.js (entry: customEvent)
  ├── require('./util')     → util.methodA(), util.methodB()
  └── require('./helper')   → helper.process()

        ↓ encode

coded.js
  customEvent = {
    ownMethod() { ... },
    methodA__util() { ... },      // from util
    methodB__util() { ... },      // from util
    process__helper() { ... }     // from helper
  }
```

### Decode Flow

```
coded.js + mod.map

        ↓ decode

decoded.js
  const util = require('./util');
  const helper = require('./helper');
  customEvent = {
    ownMethod() { ... },
    // methodA__util, methodB__util, process__helper removed
  }
```

## License

MIT
