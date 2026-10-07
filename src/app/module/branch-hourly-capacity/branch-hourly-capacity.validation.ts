import { z } from "zod";

const updateBranchHourlyCapacitySchema = z.object({
  body: z.object({
    capacities: z
      .array(
        z.object({
          day: z.enum([
            "MONDAY",
            "TUESDAY",
            "WEDNESDAY",
            "THURSDAY",
            "FRIDAY",
            "SATURDAY",
            "SUNDAY",
          ]),

          maxBookingsPerHour: z
            .number()
            .int()
            .positive("maxBookingsPerHour must be greater than 0"),
        }),
      )
      .min(1, "At least one capacity rule is required"),
  }),
});

export const branchHourlyCapacityValidation = {
  updateBranchHourlyCapacitySchema,
};
