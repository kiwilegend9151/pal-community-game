const typeImages = import.meta.glob(
  "../assets/types-webp/*.webp",
  {
    eager: true,
    query: "?url",
    import: "default"
  }
) as Record<string, string>;

export function getTypeImage(type: string): string | undefined {
  const wantedName =
    `${type.trim().replace(/\s+/g, "_")}.webp`.toLowerCase();

  const match = Object.entries(typeImages).find(([path]) => {
    const fileName = path.split("/").pop()?.toLowerCase();
    return fileName === wantedName;
  });

  return match?.[1];
}