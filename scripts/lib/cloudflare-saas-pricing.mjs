import { randomUUID } from 'node:crypto';

// Amounts are integer minor units, matching Cloudflare's Decimal adapter.
export const pricingSeeds = [
  {table:'SubscriptionPlan',code:'STANDARD',name:'Standard Plan',description:'Base monthly subscription for merchants',price:50000},
  {table:'AddonFeature',code:'BRANCH_STORE',name:'Branch Store',description:'Premium branch store functionality',price:10000},
  {table:'AddonFeature',code:'GROUP_BUYING',name:'Group Buying',description:'Group purchase and group buying functionality',price:15000},
  {table:'AddonFeature',code:'HAIRSTYLIST',name:'Hairstylist',description:'Premium hairstylist management functionality',price:8000},
  {table:'AddonFeature',code:'WALLET',name:'Wallet',description:'Customer wallet and top-up functionality',price:12000},
  {table:'AddonFeature',code:'REVIEWS',name:'Comment / Review',description:'Customer reviews and ratings functionality',price:5000},
];

export async function seedCloudflareSaasPricing({query,apply=false}) {
  const output=[];
  for(const seed of pricingSeeds){
    let created=false;
    if(apply){
      const now=Date.now();
      const rows=await query(`INSERT INTO "${seed.table}" (id,code,name,description,price,currency,isActive,createdAt,updatedAt) VALUES (?,?,?,?,?,'HKD',1,?,?) ON CONFLICT(code) DO NOTHING RETURNING id`,[randomUUID(),seed.code,seed.name,seed.description,seed.price,now,now]);
      created=rows.length===1;
    }
    const [row]=await query(`SELECT id,code,name,description,price,currency,isActive,createdAt,updatedAt FROM "${seed.table}" WHERE code=?`,[seed.code]);
    if(apply&&!row)throw new Error('SaaS pricing initialization incomplete');
    output.push({table:seed.table,code:seed.code,created,wouldCreate:!row,...(row?{id:row.id,priceMinor:row.price,currency:row.currency,isActive:Boolean(row.isActive)}:{priceMinor:seed.price,currency:'HKD'})});
  }
  return output;
}
