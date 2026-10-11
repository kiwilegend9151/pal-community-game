
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { randomBytes } from "node:crypto";
import { prisma } from "./database";

const LINK_EXPIRY_MS = 10 * 60 * 1000;

export async function startDiscordBot(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;

  if (!token || !clientId) {
    console.error(
      "Discord bot not started: missing Discord environment variables."
    );
    return;
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  const commands = [
    new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Check whether the bot is online."),
    new SlashCommandBuilder()
      .setName("link")
      .setDescription("Link your Discord account to your Twitch player."),
  ].map((command) => command.toJSON());

  const rest = new REST({ version: "10" }).setToken(token);

  await rest.put(Routes.applicationCommands(clientId), {
    body: commands,
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "ping") {
      await interaction.reply({
        content: "🏓 The Pal Community Game bot is online!",
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName !== "link") return;

    await interaction.deferReply({ ephemeral: true });

    try {
      const discordId = interaction.user.id;

      const existingLink = await prisma.player.findUnique({
        where: { discordId },
        select: { username: true },
      });

      if (existingLink) {
        await interaction.editReply(
          `Your Discord account is already linked to Twitch player ${existingLink.username}.`
        );
        return;
      }

      const twitchClientId = process.env.TWITCH_CLIENT_ID;
      const redirectUri = process.env.TWITCH_REDIRECT_URI;

      if (!twitchClientId || !redirectUri) {
        await interaction.editReply(
          "Account linking is temporarily unavailable. Please try again later."
        );
        return;
      }

      const state = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + LINK_EXPIRY_MS);

      await prisma.twitchLinkSession.deleteMany({
        where: {
          OR: [
            { discordId },
            { expiresAt: { lt: new Date() } },
          ],
        },
      });

      await prisma.twitchLinkSession.create({
        data: {
          state,
          discordId,
          expiresAt,
        },
      });

      const authorizeUrl = new URL(
        "https://id.twitch.tv/oauth2/authorize"
      );

      authorizeUrl.searchParams.set("client_id", twitchClientId);
      authorizeUrl.searchParams.set("redirect_uri", redirectUri);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("state", state);

      await interaction.editReply(
        [
          "🔗 **Connect your Twitch account**",
          "",
          `[Click here to authorise Twitch](${authorizeUrl.toString()})`,
          "",
          "This link expires in 10 minutes and can only be used once.",
          "Authorise the Twitch account you use to play.",
        ].join("\n")
      );
    } catch (error) {
      console.error("Discord link command failed:", error);

      await interaction.editReply(
        "❌ I couldn't create your authorisation link. Please try again."
      );
    }
  });

  client.once("clientReady", (readyClient) => {
    console.log(`Discord bot logged in as ${readyClient.user.tag}`);
  });

  await client.login(token);
}
