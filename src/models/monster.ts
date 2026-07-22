export interface Monster {
    id: string;

    species: string;
    level: number;

    hp: number;
    attack: number;
    defense: number;
    speed: number;

    rarity: string;
    shiny: boolean;
}