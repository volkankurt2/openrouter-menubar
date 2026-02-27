#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Path to the electron executable in the node_modules of this package
const electronPath = path.join(__dirname, '..', 'node_modules', '.bin', 'electron');
const appPath = path.join(__dirname, '..');

if (!fs.existsSync(electronPath)) {
  console.error('Electron binary not found. Please install dependencies.');
  process.exit(1);
}

try {
  console.log('Starting OpenRouter Menu Bar...');
  
  // Clone current env but remove the flag that forces Electron to run as a Node process
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  
  // Force telling Electron that the app starts at the root, NOT inside bin
  execSync(`"${electronPath}" "${appPath}"`, { 
    stdio: 'inherit',
    env 
  });
} catch (error) {
  console.error('Failed to start the application:', error.message);
  process.exit(1);
}
