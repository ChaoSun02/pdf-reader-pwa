const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, 'icon.svg');
const svgBuffer = fs.readFileSync(svgPath);

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

async function generateIcons() {
  for (const size of sizes) {
    const pngPath = path.join(__dirname, `icon-${size}x${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(pngPath);
    console.log(`Generated: icon-${size}x${size}.png`);
  }
  
  // Also generate a maskable 192x192 (with safe zone padding)
  const maskablePath = path.join(__dirname, 'icon-192x192-maskable.png');
  await sharp(svgBuffer)
    .resize(192, 192, { fit: 'contain', background: { r: 103, g: 80, b: 164, alpha: 1 } })
    .png()
    .toFile(maskablePath);
  console.log('Generated: icon-192x192-maskable.png');
  
  // Generate 512x512 maskable too
  const maskable512Path = path.join(__dirname, 'icon-512x512-maskable.png');
  await sharp(svgBuffer)
    .resize(512, 512, { fit: 'contain', background: { r: 103, g: 80, b: 164, alpha: 1 } })
    .png()
    .toFile(maskable512Path);
  console.log('Generated: icon-512x512-maskable.png');
}

generateIcons().catch(console.error);