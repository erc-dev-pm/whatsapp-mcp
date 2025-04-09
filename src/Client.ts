import { EventEmitter } from 'events';
import puppeteer from 'puppeteer';
import moduleRaid from '@pedroslopez/moduleraid/moduleraid';

import { Util } from './util/Util';
import { InterfaceController } from './util/InterfaceController';
import { WhatsWebURL, DefaultOptions, Events, WAState } from './util/Constants';
import { ExposeAuthStore } from './util/Injected/AuthStore/AuthStore';
import { ExposeStore } from './util/Injected/Store';
import { ExposeLegacyAuthStore } from './util/Injected/AuthStore/LegacyAuthStore';
import { ExposeLegacyStore } from './util/Injected/LegacyStore';
import { LoadUtils } from './util/Injected/Utils';
import { ChatFactory } from './factories/ChatFactory';
import { ContactFactory } from './factories/ContactFactory';
import { WebCacheFactory } from './webCache/WebCacheFactory';
import {
  ClientInfo,
  Message,
  MessageMedia,
  Contact,
  Location,
  Poll,
  PollVote,
  GroupNotification,
  Label,
  Call,
  Buttons,
  List,
  Reaction,
  Broadcast
} from './structures';
import { NoAuth } from './authStrategies/NoAuth';
import { exposeFunctionIfAbsent } from './util/Puppeteer';

interface ClientOptions {
  authStrategy?: any; // TODO: Define proper AuthStrategy type
  webVersion?: string;
  webVersionCache?: {
    type: string;
    [key: string]: any;
  };
  authTimeoutMs?: number;
  puppeteer?: puppeteer.LaunchOptions;
  qrMaxRetries?: number;
  restartOnAuthFail?: boolean;
  session?: any; // TODO: Define proper Session type
  takeoverOnConflict?: number;
  takeoverTimeoutMs?: number;
  userAgent?: string;
  ffmpegPath?: string;
  bypassCSP?: boolean;
  proxyAuthentication?: {
    username: string;
    password: string;
  };
}

/**
 * Starting point for interacting with the WhatsApp Web API
 * @extends {EventEmitter}
 */
export class Client extends EventEmitter {
  options: ClientOptions;
  authStrategy: any; // TODO: Define proper AuthStrategy type
  pupBrowser: puppeteer.Browser | null;
  pupPage: puppeteer.Page | null;
  currentIndexHtml: string | null;
  lastLoggedOut: boolean;

  constructor(options: ClientOptions = {}) {
    super();

    this.options = Util.mergeDefault(DefaultOptions, options);
    
    if(!this.options.authStrategy) {
      this.authStrategy = new NoAuth();
    } else {
      this.authStrategy = this.options.authStrategy;
    }

    this.authStrategy.setup(this);

    this.pupBrowser = null;
    this.pupPage = null;
    this.currentIndexHtml = null;
    this.lastLoggedOut = false;

    Util.setFfmpegPath(this.options.ffmpegPath);
  }

  /**
   * Injection logic
   * Private function
   */
  private async inject(): Promise<void> {
    if (!this.pupPage) throw new Error('Page not initialized');

    await this.pupPage.waitForFunction('window.Debug?.VERSION != undefined', { timeout: this.options.authTimeoutMs });

    const version = await this.getWWebVersion();
    const isCometOrAbove = parseInt(version.split('.')?.[1]) >= 3000;

    if (isCometOrAbove) {
      await this.pupPage.evaluate(ExposeAuthStore);
    } else {
      await this.pupPage.evaluate(ExposeLegacyAuthStore, moduleRaid.toString());
    }

    const needAuthentication = await this.pupPage.evaluate(async () => {
      let state = (window as any).AuthStore.AppState.state;

      if (state === 'OPENING' || state === 'UNLAUNCHED' || state === 'PAIRING') {
        // wait till state changes
        await new Promise<void>(r => {
          (window as any).AuthStore.AppState.on('change:state', function waitTillInit(_AppState: any, state: string) {
            if (state !== 'OPENING' && state !== 'UNLAUNCHED' && state !== 'PAIRING') {
              (window as any).AuthStore.AppState.off('change:state', waitTillInit);
              r();
            } 
          });
        }); 
      }
      state = (window as any).AuthStore.AppState.state;
      return state == 'UNPAIRED' || state == 'UNPAIRED_IDLE';
    });

    if (needAuthentication) {
      const { failed, failureEventPayload, restart } = await this.authStrategy.onAuthenticationNeeded();

      if(failed) {
        /**
         * Emitted when there has been an error while trying to restore an existing session
         * @event Client#auth_failure
         * @param {string} message
         */
        this.emit(Events.AUTHENTICATION_FAILURE, failureEventPayload);
        await this.destroy();
        if (restart) {
          // session restore failed so try again but without session to force new authentication
          return this.initialize();
        }
        return;
      }

      // Register qr events
      let qrRetries = 0;
      await exposeFunctionIfAbsent(this.pupPage, 'onQRChangedEvent', async (qr: string) => {
        /**
        * Emitted when a QR code is received
        * @event Client#qr
        * @param {string} qr QR Code
        */
        this.emit(Events.QR_RECEIVED, qr);
        if (this.options.qrMaxRetries && this.options.qrMaxRetries > 0) {
          qrRetries++;
          if (qrRetries > this.options.qrMaxRetries) {
            this.emit(Events.DISCONNECTED, 'Max qrcode retries reached');
            await this.destroy();
          }
        }
      });

      await this.pupPage.evaluate(async () => {
        const registrationInfo = await (window as any).AuthStore.RegistrationUtils.waSignalStore.getRegistrationInfo();
        const noiseKeyPair = await (window as any).AuthStore.RegistrationUtils.waNoiseInfo.get();
        const staticKeyB64 = (window as any).AuthStore.Base64Tools.encodeB64(noiseKeyPair.staticKeyPair.pubKey);
        const identityKeyB64 = (window as any).AuthStore.Base64Tools.encodeB64(registrationInfo.identityKeyPair.pubKey);
        const advSecretKey = await (window as any).AuthStore.RegistrationUtils.getADVSecretKey();
        const platform = (window as any).AuthStore.RegistrationUtils.DEVICE_PLATFORM;
        const getQR = (ref: string) => ref + ',' + staticKeyB64 + ',' + identityKeyB64 + ',' + advSecretKey + ',' + platform;
        
        (window as any).onQRChangedEvent(getQR((window as any).AuthStore.Conn.ref)); // initial qr
        (window as any).AuthStore.Conn.on('change:ref', (_: any, ref: string) => { 
          (window as any).onQRChangedEvent(getQR(ref)); 
        }); // future QR changes
      });
    }

    await exposeFunctionIfAbsent(this.pupPage, 'onAuthAppStateChangedEvent', async (state: string) => {
      if (state == 'UNPAIRED_IDLE') {
        // refresh qr code
        (window as any).Store.Cmd.refreshQR();
      }
    });

    await exposeFunctionIfAbsent(this.pupPage, 'onAppStateHasSyncedEvent', async () => {
      const authEventPayload = await this.authStrategy.getAuthEventPayload();
      /**
       * Emitted when authentication is successful
       * @event Client#authenticated
       */
      this.emit(Events.AUTHENTICATED, authEventPayload);

      const injected = await this.pupPage.evaluate(async () => {
        return typeof (window as any).Store !== 'undefined' && typeof (window as any).WWebJS !== 'undefined';
      });

      if (!injected) {
        if (this.options.webVersionCache?.type === 'local' && this.currentIndexHtml) {
          const { type: webCacheType, ...webCacheOptions } = this.options.webVersionCache;
          const webCache = WebCacheFactory.createWebCache(webCacheType, webCacheOptions);
      
          await webCache.persist(this.currentIndexHtml, version);
        }
      }
    });
  }

  // TODO: Add remaining methods with proper TypeScript types
  // initialize(): Promise<void>
  // destroy(): Promise<void>
  // logout(): Promise<void>
  // etc...
} 