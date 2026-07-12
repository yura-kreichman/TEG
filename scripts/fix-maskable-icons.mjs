import sharp from "sharp";
import { readFileSync } from "fs";

const root = "public/icon-library/pwa";
const svgPath = `${root}/RentOS-icon.svg`;
const svg = readFileSync(svgPath);

// W3C maskable-icon safe zone: content must fit inside a circle of 80% of the
// canvas diameter (centered) to survive any launcher mask shape (circle,
// squircle, rounded-square, teardrop...). The source SVG's artwork already
// runs edge-to-edge to its own rounded-rect background, so without this
// padding step, aggressive maskers (MIUI's uniform icon-shape feature, seen
// in the user's 2026-07-12 screenshot) crop straight through the mark.
// Scaling the whole icon (art + its own light background) down to 66% and
// centering it on a matching solid backdrop gives ~17% margin on each side —
// comfortably inside the 80% safe circle — while keeping the backdrop a
// seamless color match so there's no visible seam.
const SAFE_SCALE = 0.66;
const BG = "#fbfbfb"; // matches the lightest stop (#FEFEFE) of the icon's own background gradient

async function buildMaskable(size, outFile) {
  const artSize = Math.round(size * SAFE_SCALE);
  const art = await sharp(svg, { density: 384 }).resize(artSize, artSize).png().toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: art, gravity: "center" }])
    .png()
    .toFile(outFile);
  console.log("wrote", outFile);
}

async function buildFlat(size, outFile) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(outFile);
  console.log("wrote", outFile);
}

await buildMaskable(180, `${root}/icon-180-maskable.png`);
await buildMaskable(192, `${root}/icon-192-maskable.png`);
await buildMaskable(512, `${root}/icon-512-maskable.png`);
// Flat/"any" icons: keep full-bleed (correct per spec — launchers only mask
// icons declared purpose:maskable), just re-rasterize from the new source art.
await buildFlat(192, `${root}/icon-192.png`);
await buildFlat(512, `${root}/icon-512.png`);

console.log("done");
