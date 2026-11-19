// Disposable integration build only. Financial regression scenarios explicitly
// use a wallet-licensed client; the shipped client configuration is unchanged.
import { featureLicenseConfig } from '../../src/app/config/feature-license.config.ts';
import { groupPurchaseService } from '../../src/app/module/group-purchase/group-purchase.service.ts';
import { walletService } from '../../src/app/module/wallet/wallet.service.ts';
featureLicenseConfig.features.WALLET.enabled = true;
const baseline = structuredClone(featureLicenseConfig);
export async function featureLicenseTestControl(input) {
  if (input.reset) {
    Object.assign(featureLicenseConfig.license, structuredClone(baseline.license));
    for (const code of Object.keys(baseline.features)) {
      for (const key of Object.keys(featureLicenseConfig.features[code])) delete featureLicenseConfig.features[code][key];
      Object.assign(featureLicenseConfig.features[code], structuredClone(baseline.features[code]));
    }
  }
  if (input.license) Object.assign(featureLicenseConfig.license, input.license);
  for (const [code, fields] of Object.entries(input.features ?? {})) {
    if (!(code in baseline.features)) throw new Error('Unknown synthetic feature');
    Object.assign(featureLicenseConfig.features[code], fields);
  }
  if (input.probeServices) {
    const results={};
    for(const [name,run] of Object.entries({
      purchase:()=>groupPurchaseService.createGroupPurchase('synthetic-customer',{packageId:'synthetic-package',quantity:1}),
      topup:()=>walletService.createTopup('synthetic-customer',{promotionId:'synthetic-promotion'}),
      appointmentPayment:()=>walletService.payAppointmentWithWallet('synthetic-customer','synthetic-appointment',{useBonus:false}),
      purchasePayment:()=>walletService.payGroupPurchaseWithWallet('synthetic-customer','synthetic-purchase',{useBonus:false}),
    })) {try{await run();results[name]=200;}catch(error){results[name]=error.statusCode??500;}}
    return results;
  }
  return { configured: true };
}
