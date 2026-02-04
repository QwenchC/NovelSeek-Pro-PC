const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const iconsDir = path.join(__dirname, 'src-tauri', 'icons');
const svgPath = path.join(iconsDir, 'app-icon.svg');

// Ensure icons directory exists
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Read SVG
const svgBuffer = fs.readFileSync(svgPath);

// Generate PNG icons
async function generateIcons() {
  try {
    // Generate various PNG sizes
    await sharp(svgBuffer).resize(32, 32).png().toFile(path.join(iconsDir, '32x32.png'));
    console.log('✓ Generated 32x32.png');
    
    await sharp(svgBuffer).resize(128, 128).png().toFile(path.join(iconsDir, '128x128.png'));
    console.log('✓ Generated 128x128.png');
    
    await sharp(svgBuffer).resize(256, 256).png().toFile(path.join(iconsDir, '128x128@2x.png'));
    console.log('✓ Generated 128x128@2x.png');
    
    await sharp(svgBuffer).resize(256, 256).png().toFile(path.join(iconsDir, 'icon.png'));
    console.log('✓ Generated icon.png');
    
    // For .ico and .icns, we'll create a note to install additional tools
    console.log('\n⚠ Note: For .ico (Windows) and .icns (macOS) files, please:');
    console.log('  1. Install png-to-ico: npm install -g png-to-ico');
    console.log('  2. Run: png-to-ico src-tauri/icons/icon.png src-tauri/icons/icon.ico --sizes 256,128,64,48,32,16');
    console.log('  3. For macOS, use: npm install -g png2icons');
    console.log('     Then: png2icons src-tauri/icons/icon.png src-tauri/icons/icon.icns');
    
  } catch (error) {
    console.error('Error generating icons:', error.message);
    process.exit(1);
  }
}

generateIcons();
