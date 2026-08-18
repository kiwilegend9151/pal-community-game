import fs from "fs";
import path from "path";
import sharp from "sharp";

const inputDir = path.resolve("src/assets/pals");
const outputDir = path.resolve("src/assets/pals-webp");

fs.mkdirSync(outputDir, { recursive: true });

const files = fs
  .readdirSync(inputDir)
  .filter((file) => file.toLowerCase().endsWith(".png"));

for (const file of files) {
  const inputPath = path.join(inputDir, file);

  const safeBaseName = path
    .basename(file, path.extname(file))
    .replace(/\s+/g, "_");

  const outputPath = path.join(
    outputDir,
    `${safeBaseName}.webp`
  );

  await sharp(inputPath)
    .resize(256, 256, {
      fit: "contain",
      withoutEnlargement: true
    })
    .webp({
      quality: 82,
      effort: 6
    })
    .toFile(outputPath);

  console.log(`Converted: ${file}`);
}

console.log(`Done. Converted ${files.length} images.`);