[English](README.en.md)

# my-custom-js-converter

基于 Babel 的 JavaScript 代码转换器，用于扁平化和还原 CommonJS 模块结构。

## 功能

- **编码（Encode）** — 递归扫描 `require()` 依赖，从每个模块中提取被使用的方法，扁平化到单个文件中并重命名方法（如 `helperMethod__util`）。
- **解码（Decode）** — 读取生成的依赖映射文件，还原原始模块结构，重新插入 `require()` 语句并恢复方法命名。
- **摇树优化（Tree-shaking）** — 编码输出仅包含实际使用的方法，未使用的方法会被移除。
- **可配置** — 入口对象名、文件名、忽略列表和扫描目录均可通过 `config.json` 配置。

## 安装

```bash
npm install @kezh/my-custom-js-converter
# 或
pnpm add @kezh/my-custom-js-converter
```

## 使用方式

### 1. 创建配置文件

在项目根目录创建 `config.json`：

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

#### 配置项

| 字段 | 说明 |
|---|---|
| `encode.file` | 编码的源文件名 |
| `encode.output` | 编码输出文件名 |
| `encode.entry` | 源码中的入口对象名 |
| `encode.ignoreMod` | 编码时忽略的模块名 |
| `decode.file` | 待解码的文件名 |
| `decode.output` | 解码输出文件名 |
| `decode.mount` | 解码代码的挂载对象名 |
| `target` | 扫描目录（相对于项目根目录） |
| `settingDir` | 依赖映射文件存放目录 |

### 2. 编码

```bash
npx encode
```

扫描 `target` 目录中匹配 `encode.file` 的文件，构建依赖映射，输出：
- `encode.output` — 扁平化后的代码文件
- `settingDir/mod.map` — 依赖映射文件（解码时需要）

### 3. 解码

```bash
npx decode
```

读取 `settingDir/mod.map` 中的依赖映射，还原 `require()` 导入，恢复方法命名，输出 `decode.output`。

## 工作原理

### 编码流程

```
index.js (entry: customEvent)
  ├── require('./util')     → util.methodA(), util.methodB()
  └── require('./helper')   → helper.process()

        ↓ encode

coded.js
  customEvent = {
    ownMethod() { ... },
    methodA__util() { ... },      // 来自 util
    methodB__util() { ... },      // 来自 util
    process__helper() { ... }     // 来自 helper
  }
```

### 解码流程

```
coded.js + mod.map

        ↓ decode

decoded.js
  const util = require('./util');
  const helper = require('./helper');
  customEvent = {
    ownMethod() { ... },
    // methodA__util 等已移除
  }
```

## 许可证

MIT
