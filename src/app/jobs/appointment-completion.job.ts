import cron from "node-cron";

import { logUnexpectedError } from "../utils/normalize-error.js";

import { retryIdempotentDatabaseOperation } from "../utils/retry-database.js";

import { appointmentService } from "../module/appointment/appointment.service.js";

export const startAppointmentCompletionJob = () => {
  cron.schedule(
    "* * * * *",

    async () => {
      try {
        const result = await retryIdempotentDatabaseOperation(() =>
          appointmentService.completeEligibleAppointments(),
        );

        if (result.completedCount > 0) {
          console.log(
            `[Appointment Completion Job] ${result.completedCount} appointment(s) automatically completed`,
          );
        }
      } catch (error) {
        logUnexpectedError(error, {
          source: "src/app/jobs/appointment-completion.job.ts",
        });
      }
    },

    {
      noOverlap: true,
    },
  );

  console.log("[Appointment Completion Job] Started - runs every 1 minute");
};
