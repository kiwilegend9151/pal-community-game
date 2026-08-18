const palImages = import.meta.glob(
  "../assets/pals-webp/*.webp",
  {
    eager: true,
    query: "?url",
    import: "default"
  }
) as Record<string, string>;

export function getPalImage(species: string): string | undefined {
  const wantedName =
    `${species.trim().replace(/\s+/g, "_")}.webp`.toLowerCase();

  const match = Object.entries(palImages).find(([path]) => {
    const fileName = path.split("/").pop()?.toLowerCase();
    return fileName === wantedName;
  });

  return match?.[1];
}