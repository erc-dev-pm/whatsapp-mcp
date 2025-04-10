declare module './util/Util' {
    const Util: any;
    export { Util };
}

declare module './util/InterfaceController' {
    const InterfaceController: any;
    export { InterfaceController };
}

declare module './factories/ChatFactory' {
    const ChatFactory: any;
    export { ChatFactory };
}

declare module './factories/ContactFactory' {
    const ContactFactory: any;
    export { ContactFactory };
}

declare module './webCache/WebCacheFactory' {
    const WebCacheFactory: any;
    export { WebCacheFactory };
}

declare module './authStrategies/NoAuth' {
    const NoAuth: any;
    export { NoAuth };
}

// Add a global declaration for the window object
declare global {
    interface Window {
        AuthStore: any;
        Store: any;
        WWebJS: any;
        onQRChangedEvent: any;
    }
} 