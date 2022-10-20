export class MapConfig {
  [mod: string]: Mod;
}

export class Mod {
  src: string;
  dependencies: Dependencies;
  constructor(src: string, dependencies: Dependencies = new Dependencies()) {
    this.src = src;
    this.dependencies = dependencies;
  }
}

export class Dependencies {
  [name: string]: Dependency
}


export class Dependency {
  methods: string[];
  constructor(methods: string[]=[]) {
    this.methods = methods;
  }
}