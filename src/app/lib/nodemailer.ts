import nodemailer from "nodemailer";
import config from "../config/index.js";

export const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,

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

    console.log("Gmail SMTP connected successfully");

    return true;
  } catch (error) {
    console.error("Gmail SMTP connection failed:", error);

    return false;
  }
};
