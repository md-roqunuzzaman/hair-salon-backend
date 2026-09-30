import { z } from "zod";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const getBranchReportValidationSchema = z.object({
  body: z
    .object({
      from: z.string().regex(dateRegex, "from must be YYYY-MM-DD").optional(),

      to: z.string().regex(dateRegex, "to must be YYYY-MM-DD").optional(),
    })
    .refine(
      (data) => {
        if (!data.from || !data.to) {
          return true;
        }

        return data.from <= data.to;
      },
      {
        message: "from cannot be after to",
      },
    ),
});

const getBookingConversionReportValidationSchema = z.object({
  body: z
    .object({
      branchId: z.string().uuid().optional(),

      staffId: z.string().uuid().optional(),

      serviceId: z.string().uuid().optional(),

      packageId: z.string().uuid().optional(),

      from: z.string().regex(dateRegex, "from must be YYYY-MM-DD").optional(),

      to: z.string().regex(dateRegex, "to must be YYYY-MM-DD").optional(),
    })
    .refine(
      (data) => {
        if (!data.from || !data.to) {
          return true;
        }

        return data.from <= data.to;
      },
      {
        message: "from cannot be after to",
      },
    ),
});

export const reportValidation = {
  getBranchReportValidationSchema,
  getBookingConversionReportValidationSchema,
};
