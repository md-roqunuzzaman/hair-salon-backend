import { logUnexpectedError } from "../utils/normalize-error.js";
import cron from "node-cron";

import { groupPurchaseExpiryService } from "../module/group-purchase/group-purchase-expiry.service.js";

import { retryIdempotentDatabaseOperation } from "../utils/retry-database.js";

export const startGroupPurchaseExpiryJob = () => {
  cron.schedule(
    "* * * * *",

    async () => {
      try {
        const result = await retryIdempotentDatabaseOperation(() =>
          groupPurchaseExpiryService.expirePendingGroupPurchases(),
        );

        if (result.expiredCount > 0) {
          console.log(
            `[Group Purchase Expiry Job] ${result.expiredCount} purchase(s) expired`,
          );
        }
      } catch (error) {
        logUnexpectedError(error, { source: "src/app/jobs/group-purchase-expiry.job.ts:23" });
      }
    },

    {
      noOverlap: true,
    },
  );

  console.log("[Group Purchase Expiry Job] Started - runs every 1 minute");
};
