let extensionToken = "";

export type TwitchExtensionMode =
  | "config"
  | "dashboard"
  | "viewer"
  | undefined;

export function getExtensionToken(): string {
  return extensionToken;
}

export interface TwitchAuthorization {
  channelId: string;
  clientId: string;
  token: string;
  userId: string;
}

export function initialiseTwitch(
  onAuthorised: (auth: TwitchAuthorization) => void,
  onMode: (mode: TwitchExtensionMode) => void
): void {
  const isLocalDevelopment =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  if (isLocalDevelopment) {
    extensionToken = "local-development";

    onMode("viewer");

    onAuthorised({
      channelId: "local",
      clientId: "local",
      token: extensionToken,
      userId: "580966596"
    });

    return;
  }

  const helper = window.Twitch?.ext;

  console.log("[TWITCH] helper:", helper);

  if (!helper) {
    console.error("[TWITCH] Extension helper is missing");
    throw new Error("Twitch Extension helper could not be loaded");
  }

  console.log("[TWITCH] registering onContext");

  const contextHelper = helper as typeof helper & {
    onContext(
      callback: (
        context: {
          mode?: string;
          [key: string]: unknown;
        },
        changedProperties: string[]
      ) => void
    ): void;
  };

  contextHelper.onContext((context, changedProperties) => {
    console.log("[TWITCH] CONTEXT", {
      mode: context?.mode,
      changedProperties,
      context
    });

    onMode(context?.mode as TwitchExtensionMode);
  });

  console.log("[TWITCH] registering onAuthorized");

  helper.onAuthorized((auth) => {
    console.log("[TWITCH] AUTHORIZED", {
      channelId: auth.channelId,
      userId: auth.userId,
      hasToken: Boolean(auth.token)
    });

    extensionToken = auth.token;

    console.log("[TWITCH] calling App callback");

    onAuthorised({
      channelId: auth.channelId,
      clientId: auth.clientId,
      token: auth.token,
      userId: auth.userId
    });
  });
}

export function requestIdentityShare(): void {
  window.Twitch?.ext.actions.requestIdShare();
}