import { logUnexpectedError } from "../utils/normalize-error.js";
import cron from "node-cron";
import { appointmentService } from "../module/appointment/appointment.service.js";
import { retryIdempotentDatabaseOperation } from "../utils/retry-database.js";

import { sendAppointmentReminders } from "../module/notification/notification-reminder.service.js";

export const startAppointmentExpiryJob = () => {
  cron.schedule("* * * * *", async () => {
    try {
      const result = await retryIdempotentDatabaseOperation(
        () => appointmentService.expirePendingAppointments(),
      );

      await retryIdempotentDatabaseOperation(() => sendAppointmentReminders());

      if (result.expiredCount > 0) {
        console.log(
          `[Appointment Expiry Job] ${result.expiredCount} appointment(s) expired`,
        );
      }
    } catch (error) {
      logUnexpectedError(error, { source: "src/app/jobs/appointment-expiry.job.ts:18" });
    }
  }, { noOverlap: true });

  console.log("[Appointment Expiry Job] Started - runs every 1 minute");
};
