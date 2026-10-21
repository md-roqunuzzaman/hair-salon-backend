import { logUnexpectedError } from "../utils/normalize-error.js";
import nodemailer from "nodemailer";
import config from "../config/index.js";

export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT || 465),
  secure: Number(process.env.SMTP_PORT || 465) === 465,

  requireTLS: true,

  auth: {
    user: config.smtp_user,
    pass: config.smtp_password,
  },

  connectionTimeout: 30000,
  greetingTimeout: 15000,
  socketTimeout: 30000,
});

export const verifyEmailConnection = async () => {
  try {
    await transporter.verify();

    console.log("SMTP connected successfully");

    return true;
  } catch (error) {
    logUnexpectedError(error, { source: "src/app/lib/nodemailer.ts:29" });

    return false;
  }
};
