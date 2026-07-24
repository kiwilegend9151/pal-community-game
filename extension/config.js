const status = document.getElementById("status");

if (!window.Twitch?.ext) {
    status.textContent =
        "Twitch Extension Helper failed to load. Disable blockers and refresh.";
} else {
    let authorized = false;

    const timeout = setTimeout(() => {
        if (!authorized) {
            status.textContent =
                "Twitch authorization did not arrive. Open this through Twitch Configure and check browser blockers.";
        }
    }, 10000);

    window.Twitch.ext.onAuthorized(async (auth) => {
        authorized = true;
        clearTimeout(timeout);

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
                    error:
                        responseText ||
                        `Request failed with status ${response.status}`
                };
            }

            if (!response.ok) {
                throw new Error(
                    result.error ||
                    `Setup failed with status ${response.status}`
                );
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
}