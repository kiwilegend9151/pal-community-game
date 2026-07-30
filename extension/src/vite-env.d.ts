/// <reference types="vite/client" />

interface TwitchAuthorization {
  channelId: string;
  clientId: string;
  token: string;
  userId: string;
}

interface Window {
  Twitch?: {
    ext: {
      onAuthorized(callback: (auth: TwitchAuthorization) => void): void;
      actions: { requestIdShare(): void };
    };
  };
}
