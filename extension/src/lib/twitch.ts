let extensionToken = "";

export function getExtensionToken(): string {
  return extensionToken;
}

export function initialiseTwitch(
  onAuthorised: (auth: TwitchAuthorization) => void
): void {
  const isLocalDevelopment =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  if (isLocalDevelopment) {
    extensionToken = "local-development";

    onAuthorised({
      channelId: "local",
      clientId: "local",
      token: extensionToken,
      userId: "580966596"
    });

    return;
  }

  const helper = window.Twitch?.ext;

  if (!helper) {
    throw new Error("Twitch Extension helper could not be loaded");
  }

  helper.onAuthorized((auth) => {
    extensionToken = auth.token;
    onAuthorised(auth);
  });
}

export function requestIdentityShare(): void {
  window.Twitch?.ext.actions.requestIdShare();
}