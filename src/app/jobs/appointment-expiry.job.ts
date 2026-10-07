import cron from "node-cron";
import { appointmentService } from "../module/appointment/appointment.service.js";

export const startAppointmentExpiryJob = () => {
  cron.schedule("* * * * *", async () => {
    try {
      const result = await appointmentService.expirePendingAppointments();

      if (result.expiredCount > 0) {
        console.log(
          `[Appointment Expiry Job] ${result.expiredCount} appointment(s) expired`,
        );
      }
    } catch (error) {
      console.error(
        "[Appointment Expiry Job] Failed to expire appointments:",
        error,
      );
    }
  });

  console.log("[Appointment Expiry Job] Started - runs every 1 minute");
};
