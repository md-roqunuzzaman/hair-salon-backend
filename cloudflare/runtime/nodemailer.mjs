import { applicationRuntime } from './context.mjs';
export const transporter = {
  sendMail(message) {
    const runtime = applicationRuntime.getStore();
    if (!runtime) throw new Error('Email accessed outside application runtime');
    return runtime.sendMail(message);
  },
};
export const verifyEmailConnection = async () => true;
