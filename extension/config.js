window.Twitch.ext.onAuthorized(async (auth) => {
    const status = document.getElementById("status");

    try {
        status.textContent = "Connecting bot...";

        const response = await fetch(
            "https://pal-community-game-production.up.railway.app/extension/install",
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${auth.token}`,
                    "Content-Type": "application/json"
                }
            }
        );

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "Setup failed");
        }

        status.textContent =
            `Connected! The bot has joined ${result.streamer.channelName}.`;

    } catch (error) {
        console.error(error);
        status.textContent =
            "The bot could not connect. Please try again.";
    }
});