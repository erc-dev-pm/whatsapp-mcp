declare module '@pedroslopez/moduleraid/moduleraid' {
    interface ModuleRaid {
        modules: Record<string, any>;
        constructors: Record<string, any>;
        require(id: number): any;
        get(name: string): any;
        find(query: (module: any) => boolean): any[];
    }
    
    function ModuleRaid(): ModuleRaid;
    
    export = ModuleRaid;
}