import type { Pal, PaldeckSummary, PlayerSummary } from "../types";
import { getExtensionToken } from "./twitch";

const configuredApiUrl = import.meta.env.VITE_API_BASE_URL;

if (!configuredApiUrl) {
  throw new Error("VITE_API_BASE_URL is not configured");
}

const API_BASE_URL = configuredApiUrl.replace(/\/$/, "");

type ErrorPayload = {
  error?: string;
};

type InstallResponse = {
  message: string;
};

type ShopPurchaseResponse = {
  message: string;
  coins: number;
  palSpheres: number;
  megaSpheres: number;
  gigaSpheres: number;
  hyperSpheres: number;
};

async function readError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as
    | ErrorPayload
    | null;

  return payload?.error ?? `Request failed (${response.status})`;
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${getExtensionToken()}`
    }
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return response.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getExtensionToken()}`,
      "Content-Type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return response.json() as Promise<T>;
}

export const extensionApi = {
  install: () =>
    post<InstallResponse>("/extension/install"),

  getProfile: () =>
    request<PlayerSummary>("/extension/me"),

  getPals: () =>
    request<{ total: number; pals: Pal[] }>("/extension/pals"),

  getPaldex: () =>
    request<PaldeckSummary>("/extension/paldex"),

  buySphere: (
    sphereType: "pal" | "mega" | "giga" | "hyper",
    quantity: number
  ) =>
    post<ShopPurchaseResponse>("/extension/shop/buy", {
      sphereType,
      quantity
    }),

  getExpedition: () =>
    request<ExpeditionStatusResponse>(
      "/extension/expedition"
    ),

  sendExpedition: (monsterId: string) =>
    post<{ message: string; completesAt: string }>(
      "/extension/expedition/send",
      {
        monsterId
      }
    ),

  claimExpedition: () =>
    post<ExpeditionClaimResponse>(
      "/extension/expedition/claim"
    )
};

export type ExpeditionStatusResponse =
  | {
      active: false;
    }
  | {
      active: true;
      completed: boolean;
      expedition: {
        id: string;
        monsterId: string;
        species: string;
        shiny: boolean;
        startedAt: string;
        completesAt: string;
      };
    };

export type ExpeditionClaimResponse = {
  species: string;
  coinReward: number;
  palSphereReward: number;
  paldiumReward: number;
  woodReward: number;
  stoneReward: number;
  player: PlayerSummary;
};