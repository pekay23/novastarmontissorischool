const { prisma } = require('./packages/database');
prisma._prisma_migrations.findMany().then(r => {
  console.log(JSON.stringify(r, null, 2));
  prisma.$disconnect();
})