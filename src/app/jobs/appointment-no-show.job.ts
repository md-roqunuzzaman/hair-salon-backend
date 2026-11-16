import cron from "node-cron";
import { appointmentService } from "../module/appointment/appointment.service.js";
import { logUnexpectedError } from "../utils/normalize-error.js";
import { retryIdempotentDatabaseOperation } from "../utils/retry-database.js";

export const startAppointmentNoShowJob = () => {
  cron.schedule(
    "* * * * *",
    async () => {
      try {
        const result = await retryIdempotentDatabaseOperation(() =>
          appointmentService.autoMarkNoShowAppointments(),
        );

        if (result.noShowCount > 0) {
          console.log(
            `[Appointment No-Show Job] ${result.noShowCount} appointment(s) automatically marked as NO_SHOW`,
          );
        }
      } catch (error) {
        logUnexpectedError(error, {
          source: "src/app/jobs/appointment-no-show.job.ts",
        });
      }
    },
    {
      noOverlap: true,
    },
  );

  console.log("[Appointment No-Show Job] Started - runs every 1 minute");
};
