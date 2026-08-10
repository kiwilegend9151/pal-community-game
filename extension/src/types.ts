export type TabId =
  | "profile"
  | "pals"
  | "inventory"
  | "shop"
  | "expedition"
  | "paldex";

export interface Pal {
  id: string;
  species: string;
  level: number;
  shiny: boolean;
  type1: string | null;
  type2: string | null;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  createdAt: string;
  imageUrl?: string | null;
}

export interface PlayerSummary {
  username: string;
  level: number;
  xp: number;
  xpNeeded: number;
  coins: number;
  totalPals: number;
  totalLucky: number;
  palSpheres: number;
  megaSpheres: number;
  gigaSpheres: number;
  hyperSpheres: number;
  paldium: number;
  wood: number;
  stone: number;
}

export interface PaldeckSummary {
  discovered: number;
  totalSpecies: number;
  completionPercentage: number;
  luckySpecies: number;
  entries: Array<{
    id: string;
    species: string;
    paldeck: string | null;
    hasLucky: boolean;
    discoveredAt: string;
  }>;
}
