const fs = require('fs');
const path = require('path');
const toIco = require('to-ico');

async function generateIco() {
  const iconPath = path.join(__dirname, 'src-tauri/icons/icon.png');
  const icoPath = path.join(__dirname, 'src-tauri/icons/icon.ico');

  try {
    const png = fs.readFileSync(iconPath);
    const buf = await toIco([png], { sizes: [16, 24, 32, 48, 64, 128, 256] });
    fs.writeFileSync(icoPath, buf);
    console.log('✓ Generated icon.ico successfully!');
  } catch (err) {
    console.error('Error generating ICO:', err);
    process.exit(1);
  }
}

generateIco();
