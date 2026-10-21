import { logUnexpectedError } from "./normalize-error.js";

export function installFatalErrorHandlers() {
  process.once("unhandledRejection", error => {
    logUnexpectedError(error, { source: "unhandledRejection" });
    process.exit(1);
  });
  process.once("uncaughtException", error => {
    logUnexpectedError(error, { source: "uncaughtException" });
    process.exit(1);
  });
}
