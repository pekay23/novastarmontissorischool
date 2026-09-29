const { PrismaClient } = require('@prisma/client');
const { PrismaNeon } = require('@prisma/adapter-neon');

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const schools = await prisma.school.findMany({
    select: { id: true, code: true, name: true, tenantId: true },
  });
  console.log('SCHOOLS:', JSON.stringify(schools, null, 2));

  const roles = await prisma.role.findMany({ select: { name: true, schoolId: true } });
  console.log('ROLES:', roles.map((r) => r.name).join(', '));

  const users = await prisma.user.findMany({
    select: {
      email: true,
      name: true,
      schoolId: true,
      tenantId: true,
      isActive: true,
      emailVerified: true,
      role: { select: { name: true } },
    },
  });
  console.log('USERS:', JSON.stringify(users, null, 2));
}

main()
  .catch((e) => console.error('ERR', e.message))
  .finally(() => prisma.$disconnect());
