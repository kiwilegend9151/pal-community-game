export interface Player {
    id: string;
    twitchId: string;
    username: string;

    level: number;
    xp: number;
    coins: number;

    createdAt: Date;
}