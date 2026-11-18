// Disposable Worker control; excluded from the production entry point.
export async function branchBrandFixture(db, body) {
  const brand = await db.brand.findFirstOrThrow({ select: { id: true } });
  if (body.ownerCheck) {
    const owner = await db.user.findFirstOrThrow({ where: { role: 'BRAND_OWNER' }, select: { id: true } });
    if (body.assignOwner) await db.brand.update({ where: { id: brand.id }, data: { ownerId: owner.id } });
    return {
      brand: await db.brand.findUniqueOrThrow({ where: { id: brand.id }, select: { id: true, ownerId: true, owner: { select: { id: true, role: true } } } }),
      owner: await db.user.findUniqueOrThrow({ where: { id: owner.id }, select: { id: true, ownedBrands: { select: { id: true, ownerId: true } } } }),
    };
  }
  if (body.superAdminCheck) {
    const user = await db.user.create({ data: { name: 'Synthetic Super Admin', email: `super-admin-${crypto.randomUUID()}@example.com`, passwordHash: 'not-a-login-credential', role: 'SUPER_ADMIN' }, select: { id: true, role: true } });
    return { user: await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { id: true, role: true, ownedBrands: { select: { id: true } } } }) };
  }
  if (body.assign) await db.branch.update({ where: { id: body.branchId }, data: { brandId: brand.id } });
  return {
    brand: await db.brand.findUniqueOrThrow({ where: { id: brand.id }, select: { id: true, branches: { select: { id: true, brandId: true } } } }),
    branch: await db.branch.findUniqueOrThrow({ where: { id: body.branchId }, select: { id: true, brandId: true, brand: { select: { id: true } } } }),
  };
}
