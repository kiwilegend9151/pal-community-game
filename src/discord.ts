
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { randomBytes } from "node:crypto";
import { prisma } from "./database";

import {
  generateDailyReward,
  updateDailyQuestProgress,
} from "./twitch";

const LINK_EXPIRY_MS = 10 * 60 * 1000;
const DAILY_CHANNEL_ID = "1559232551481245898";

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
  new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Claim your daily Pal Community Game reward."),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show Pal Community Game Discord commands."),
].map((command) => command.toJSON());



  const rest = new REST({ version: "10" }).setToken(token);

  await rest.put(Routes.applicationCommands(clientId), {
    body: commands,
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;


if (interaction.commandName === "help") {
  await interaction.reply({
    content:
      "🎮 **Pal Community Game — Discord Commands**\n\n" +
      "🎁 `/daily` — Claim your daily reward in the designated daily channel.\n" +
      "🔗 `/link` — Link your Discord account to your Twitch player.\n" +
      "🏓 `/ping` — Check whether the bot is online.\n\n" +
      "Make sure you link your Twitch account before claiming Discord rewards!",
    ephemeral: true,
  });
  return;
}


    if (interaction.commandName === "ping") {
      await interaction.reply({
        content: "🏓 The Pal Community Game bot is online!",
        ephemeral: true,
      });
      return;
    }


    if (interaction.commandName === "daily") {
      if (interaction.channelId !== DAILY_CHANNEL_ID) {
        await interaction.reply({
          content: "Please use `/daily` in <#1559232551481245898>.",
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply();

      try {
        const player = await prisma.player.findUnique({
          where: { discordId: interaction.user.id },
          select: { id: true },
        });

        if (!player) {
          await interaction.editReply(
            "🔗 Link your Twitch account first using `/link`."
          );
          return;
        }

        const now = new Date();
        const shiftedDate = new Date(
          now.getTime() - 12 * 60 * 60 * 1000
        );

        const parts = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/London",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).formatToParts(shiftedDate);

        const year = parts.find(p => p.type === "year")?.value ?? "";
        const month = parts.find(p => p.type === "month")?.value ?? "";
        const day = parts.find(p => p.type === "day")?.value ?? "";
        const currentDailyPeriod = `${year}-${month}-${day}`;

        const reward = generateDailyReward();

        const claimed = await prisma.player.updateMany({
          where: {
            id: player.id,
            OR: [
              { dailyPeriod: null },
              { dailyPeriod: { not: currentDailyPeriod } },
            ],
          },
          data: {
            coins: { increment: reward.coins },
            palSpheres: { increment: reward.palSpheres },
            megaSpheres: { increment: reward.megaSpheres },
            gigaSpheres: { increment: reward.gigaSpheres },
            hyperSpheres: { increment: reward.hyperSpheres },
            lastDailyAt: now,
            dailyPeriod: currentDailyPeriod,
          },
        });

        if (claimed.count === 0) {
          await interaction.editReply(
            "⏳ You've already claimed today's reward. Your next reward is available at 12:00 PM UK time."
          );
          return;
        }

        await updateDailyQuestProgress(player.id, "claim_daily", 1);

        const updatedPlayer = await prisma.player.findUnique({
          where: { id: player.id },
          select: { coins: true },
        });

        const rewards: string[] = [];
        if (reward.coins > 0) rewards.push(`${reward.coins} coins`);
        if (reward.palSpheres > 0) rewards.push(`${reward.palSpheres} Pal Spheres`);
        if (reward.megaSpheres > 0) rewards.push(`${reward.megaSpheres} Mega Spheres`);
        if (reward.gigaSpheres > 0) rewards.push(`${reward.gigaSpheres} Giga Spheres`);
        if (reward.hyperSpheres > 0) rewards.push(`${reward.hyperSpheres} Hyper Spheres`);

        await interaction.editReply(
          `🎁 You received a **${reward.tier}** daily reward!\n` +
          `🎉 ${rewards.join(" • ")}\n` +
          `💰 Balance: ${updatedPlayer?.coins ?? 0} coins.`
        );
      } catch (error) {
        console.error("Discord daily command failed:", error);
        await interaction.editReply(
          "❌ Your daily reward couldn't be claimed. Please try again later."
        );
      }

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
