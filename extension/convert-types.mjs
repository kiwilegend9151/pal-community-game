import fs from "fs";
import path from "path";
import sharp from "sharp";

const inputDir = path.resolve("src/assets/types");
const outputDir = path.resolve("src/assets/types-webp");

fs.mkdirSync(outputDir, { recursive: true });

const files = fs
  .readdirSync(inputDir)
  .filter((file) => file.toLowerCase().endsWith(".png"));

for (const file of files) {
  const inputPath = path.join(inputDir, file);

  const safeBaseName = path
    .basename(file, path.extname(file))
    .trim()
    .replace(/\s+/g, "_");

  const outputPath = path.join(
    outputDir,
    `${safeBaseName}.webp`
  );

  await sharp(inputPath)
    .resize(64, 64, {
      fit: "contain"
    })
    .webp({
      quality: 90,
      effort: 6
    })
    .toFile(outputPath);

  console.log(`Converted: ${file} -> ${safeBaseName}.webp`);
}

console.log(`Done. Converted ${files.length} type images.`);