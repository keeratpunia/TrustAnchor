/**
 * reset-admin.ts — resets (or creates) the admin account.
 *
 * Usage (from the packages/backend folder):
 *   npx ts-node prisma/reset-admin.ts
 *
 * Or with env vars to skip prompts:
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=mynewpass npx ts-node prisma/reset-admin.ts
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import * as readline from 'readline';

const prisma = new PrismaClient();

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log('\n🔐 TrustAnchor Admin Account Reset\n');

  // Show existing admin accounts first
  const allAdmins = await prisma.adminAccount.findMany({ select: { email: true, name: true } });
  if (allAdmins.length > 0) {
    console.log('Existing admin accounts:');
    allAdmins.forEach((a) => console.log(`  • ${a.email} (${a.name})`));
    console.log('');
  } else {
    console.log('No admin accounts found — will create a new one.\n');
  }

  const email = (process.env.ADMIN_EMAIL || await ask('Admin email (enter to reset, or new email to create): ')).toLowerCase();
  if (!email || !email.includes('@')) {
    console.error('Invalid email. Aborting.');
    process.exit(1);
  }

  const password = process.env.ADMIN_PASSWORD || await ask('New password: ');
  if (!password || password.length < 6) {
    console.error('Password must be at least 6 characters. Aborting.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.adminAccount.findUnique({ where: { email } });

  if (existing) {
    await prisma.adminAccount.update({ where: { email }, data: { passwordHash } });
    console.log(`\n✓ Password updated for: ${email}`);
  } else {
    const name = process.env.ADMIN_NAME || await ask('Display name for new admin: ') || 'Platform Admin';
    await prisma.adminAccount.create({ data: { name, email, passwordHash } });
    console.log(`\n✓ New admin account created: ${email}`);
  }

  console.log('You can now log in at the admin portal.\n');
}

main()
  .catch((err) => { console.error('Failed:', err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
