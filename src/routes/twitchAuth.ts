
import { Router } from "express";
import { prisma } from "../database";

const router = Router();

const SESSION_LIFETIME_MS = 10 * 60 * 1000;

router.get("/callback", async (req, res) => {
  const code = typeof req.query.code === "string"
    ? req.query.code
    : undefined;

  const state = typeof req.query.state === "string"
    ? req.query.state
    : undefined;

  if (req.query.error || !code || !state) {
    res.status(400).send("Twitch authorisation was cancelled or failed. You can try /link again in Discord.");
    return;
  }

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  const redirectUri = process.env.TWITCH_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    console.error("Twitch OAuth environment variables are missing.");
    res.status(500).send("Account linking is temporarily unavailable.");
    return;
  }

  try {
    // Find and claim the short-lived session so it cannot be reused.
    const session = await prisma.twitchLinkSession.findUnique({
      where: { state },
    });

    if (!session || session.expiresAt <= new Date()) {
      if (session) {
        await prisma.twitchLinkSession.deleteMany({
          where: { id: session.id },
        });
      }

      res.status(400).send("This linking session has expired or is invalid. Start again with /link in Discord.");
      return;
    }

    const claimed = await prisma.twitchLinkSession.deleteMany({
      where: {
        id: session.id,
        state,
        expiresAt: { gt: new Date() },
      },
    });

    if (claimed.count !== 1) {
      res.status(400).send("This linking session has already been used or has expired.");
      return;
    }

    // Exchange the authorisation code for a Twitch access token.
    const tokenResponse = await fetch(
      "https://id.twitch.tv/oauth2/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }),
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!tokenResponse.ok) {
      console.error("Twitch token exchange failed:", tokenResponse.status);
      res.status(400).send("Twitch authorisation could not be verified. Please try /link again.");
      return;
    }

    const tokenData = await tokenResponse.json() as {
      access_token?: string;
      token_type?: string;
    };

    if (!tokenData.access_token) {
      res.status(400).send("Twitch did not return a valid authorisation.");
      return;
    }

    // Ask Twitch for the authenticated user's identity.
    const userResponse = await fetch(
      "https://api.twitch.tv/helix/users",
      {
        headers: {
          "Client-ID": clientId,
          Authorization: `Bearer ${tokenData.access_token}`,
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!userResponse.ok) {
      console.error("Twitch identity lookup failed:", userResponse.status);
      res.status(400).send("We couldn't verify your Twitch account. Please try again.");
      return;
    }

    const userData = await userResponse.json() as {
      data?: Array<{ id: string; login: string; display_name: string }>;
    };

    const twitchUser = userData.data?.[0];

    if (!twitchUser) {
      res.status(400).send("No Twitch account was returned. Please try again.");
      return;
    }

    // Link only an existing player; never create or overwrite a player here.
    const player = await prisma.player.findUnique({
      where: { twitchId: twitchUser.id },
      select: { id: true, username: true, discordId: true },
    });

    if (!player) {
      res.status(404).send("Your Twitch player account wasn't found. Use !start in your Twitch channel, then try /link again.");
      return;
    }

    if (player.discordId === session.discordId) {
      res.send("Your Twitch and Discord accounts are already linked. You can close this page.");
      return;
    }

    if (player.discordId) {
      res.status(409).send("This Twitch player is already linked to another Discord account.");
      return;
    }

    const existingDiscordLink = await prisma.player.findUnique({
      where: { discordId: session.discordId },
      select: { id: true },
    });

    if (existingDiscordLink) {
      res.status(409).send("This Discord account is already linked to another Twitch player.");
      return;
    }

    // The unique constraints on twitchId and discordId protect against
    // duplicate links. Re-check the player before updating.
    const updated = await prisma.player.updateMany({
      where: {
        id: player.id,
        discordId: null,
      },
      data: {
        discordId: session.discordId,
      },
    });

    if (updated.count !== 1) {
      res.status(409).send("The account link changed while you were authorising. Please run /link again to check your account.");
      return;
    }

    res.send("Success! Your Twitch account has been linked to Discord. You can close this page and return to Discord.");
  } catch (error) {
    console.error("Twitch OAuth callback failed:", error);
    res.status(500).send("Account linking failed unexpectedly. Please try /link again.");
  }
});

export default router;
