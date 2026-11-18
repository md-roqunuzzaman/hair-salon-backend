// Disposable Worker only; never shipped in the production entry point.
import { seedSaasPricing } from '../../src/app/utils/seed.ts';
import { calculateSubscriptionPrice } from '../../src/app/module/platform/platform.pricing.ts';

export async function subscriptionFixture(db, body) {
  await seedSaasPricing();
  if(body.customize) {
    await db.subscriptionPlan.update({where:{code:'STANDARD'},data:{price:'501.25',name:'Custom Plan',isActive:false}});
    await db.addonFeature.update({where:{code:'WALLET'},data:{price:'123.45',name:'Custom Wallet',isActive:false}});
    await seedSaasPricing();
  }
  let snapshot;
  if(body.snapshot){
    const brand=await db.brand.findFirstOrThrow();
    const plan=await db.subscriptionPlan.findUniqueOrThrow({where:{code:'STANDARD'}});
    const addon=await db.addonFeature.findUniqueOrThrow({where:{code:'WALLET'}});
    const subscription=await db.brandSubscription.create({data:{brandId:brand.id,planId:plan.id,startAt:new Date(1000),endAt:new Date(2000),basePrice:'500.25',addonsPrice:'120.50',totalPrice:'620.75',addons:{create:{addonId:addon.id,startAt:new Date(1000),endAt:new Date(2000)}}}});
    snapshot=await db.brandSubscription.findUniqueOrThrow({where:{id:subscription.id},include:{brand:{select:{id:true}},plan:{select:{code:true}},addons:{include:{addon:{select:{code:true}}}}}});
  }
  return {plans:await db.subscriptionPlan.findMany({orderBy:{code:'asc'}}),addons:await db.addonFeature.findMany({orderBy:{code:'asc'}}),...(body.calculate?{calculated:await calculateSubscriptionPrice({planCode:'STANDARD',premiumFeatures:['WALLET','REVIEWS','WALLET']})}:{}),...(snapshot?{snapshot}:{})};
}
