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

async function post<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getExtensionToken()}`
    }
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return response.json() as Promise<T>;
}

type InstallResponse = {
  message: string;
};

export const extensionApi = {
  install: () => post<InstallResponse>("/extension/install"),
  getProfile: () => request<PlayerSummary>("/extension/me"),
  getPals: () => request<{ total: number; pals: Pal[] }>("/extension/pals"),
  getPaldex: () => request<PaldeckSummary>("/extension/paldex")
};