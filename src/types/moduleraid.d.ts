declare module 'moduleraid' {
    export interface ModuleRaidModule {
        id: string | number;
        exports: any;
        loaded: boolean;
    }

    export interface ModuleRaidOptions {
        logModules?: boolean;
    }

    export default class ModuleRaid {
        constructor(options?: ModuleRaidOptions);
        
        modules: Map<string | number, ModuleRaidModule>;
        constructors: Map<string, Function>;
        
        init(): void;
        get(id: string | number): ModuleRaidModule | undefined;
        findModule(query: string | RegExp | ((module: ModuleRaidModule) => boolean)): ModuleRaidModule | undefined;
        findModules(query: string | RegExp | ((module: ModuleRaidModule) => boolean)): ModuleRaidModule[];
        getModule(id: string | number): any;
        getModules(query: string | RegExp | ((module: ModuleRaidModule) => boolean)): any[];
    }
}