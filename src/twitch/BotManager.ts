import tmi from "tmi.js";

class BotManager {
    private client: tmi.Client;

    constructor() {
        this.client = new tmi.Client({
            options: {
                debug: true
            },

            identity: {
                username: process.env.TWITCH_BOT_USERNAME!,
                password: process.env.TWITCH_ACCESS_TOKEN!
            },

            channels: []
        });
    }

    async connect() {
        if (!this.client.readyState()) {
            await this.client.connect();
            console.log("✅ Twitch bot connected");
        }
    }

    async joinChannel(channel: string) {
        const channels = await this.client.getChannels();

        if (!channels.includes("#" + channel)) {
            await this.client.join(channel);

            console.log(`Joined ${channel}`);
        }
    }

    async leaveChannel(channel: string) {
        const channels = await this.client.getChannels();

        if (channels.includes("#" + channel)) {
            await this.client.part(channel);

            console.log(`Left ${channel}`);
        }
    }

    async say(channel: string, message: string) {
        await this.client.say(channel, message);
    }

    getClient() {
        return this.client;
    }
}

export default new BotManager();