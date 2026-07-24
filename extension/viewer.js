window.Twitch.ext.onAuthorized((auth) => {
    const status = document.getElementById("status");

    console.log("Extension authorized:", {
        channelId: auth.channelId,
        clientId: auth.clientId,
        userId: auth.userId
    });

    status.textContent = "Twitch Monsters is ready!";
});