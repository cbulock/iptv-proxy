#!/usr/bin/env node

/**
 * Utility script to generate bcrypt password hashes for use in app.yaml
 * Usage: node scripts/hash-password.js [password]
 */

import bcrypt from 'bcryptjs';
import readline from 'readline';

async function hashPassword(password) {
  const saltRounds = 10;
  const hash = bcrypt.hashSync(password, saltRounds);
  return hash;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length > 0) {
    // Password provided as command line argument
    const password = args[0];
    const hash = await hashPassword(password);
    console.log('\nBcrypt hash:');
    console.log(hash);
    console.log('\nAdd this to your config/app.yaml:');
    console.log('admin_auth:');
    console.log('  username: "admin"');
    console.log(`  password: "${hash}"`);
  } else {
    // Interactive mode - prompt for password
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question('Enter password to hash: ', async (password) => {
      if (!password) {
        console.error('Error: Password cannot be empty');
        rl.close();
        process.exit(1);
      }
      
      const hash = await hashPassword(password);
      console.log('\nBcrypt hash:');
      console.log(hash);
      console.log('\nAdd this to your config/app.yaml:');
      console.log('admin_auth:');
      console.log('  username: "admin"');
      console.log(`  password: "${hash}"`);
      rl.close();
    });
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
