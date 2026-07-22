import BotManager from "./BotManager";

export async function startBot() {
    await BotManager.connect();
}