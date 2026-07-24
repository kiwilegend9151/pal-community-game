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

        const responseText = await response.text();

        let result;

        try {
            result = JSON.parse(responseText);
        } catch {
            result = {
                error: responseText || `Request failed with status ${response.status}`
            };
        }

        if (!response.ok) {
            throw new Error(
                result.error ||
                `Setup failed with status ${response.status}`
            );
        }

        if (!result.streamer?.channelName) {
            throw new Error("The server did not return a channel name");
        }

        status.textContent =
            `Connected! The bot has joined ${result.streamer.channelName}.`;

    } catch (error) {
        console.error("Extension installation failed:", error);

        status.textContent =
            `Connection failed: ${
                error instanceof Error ? error.message : String(error)
            }`;
    }
});