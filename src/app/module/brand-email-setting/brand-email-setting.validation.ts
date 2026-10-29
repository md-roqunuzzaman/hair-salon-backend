import { z } from 'zod';

const email = z.email().max(320).transform(value => value.toLowerCase());
const common = { fromName: z.string().trim().min(1).max(150).refine(v => !/[\r\n<>]/.test(v)), fromEmail: email };
const password = z.string().min(1).max(4096).refine(value => !!value.trim()).optional();
const smtpAccount = { ...common, smtpUsername: email, password };
// Status fields are server-owned: save cannot override manual disable or forge
// verification. Existing enable/disable endpoints remain the explicit controls.
export const emailProviderConfigurationSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('GMAIL'), ...smtpAccount }).strict(),
  z.object({ provider: z.literal('QQ'), ...smtpAccount }).strict(),
  z.object({ provider: z.literal('NETEASE_163'), ...smtpAccount }).strict(),
  z.object({ provider: z.literal('MICROSOFT_365'), ...common }).strict(),
  z.object({ provider: z.literal('RESEND'), ...common, apiKey: password }).strict(),
  z.object({ provider: z.literal('CUSTOM_SMTP'), ...common, smtpHost: z.string().trim().toLowerCase().max(253)
    .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
    smtpPort: z.union([z.literal(465), z.literal(587), z.literal(2525)]), smtpSecure: z.boolean(),
    smtpUsername: z.string().trim().min(1).max(320).refine(v => !/[\r\n]/.test(v)), password }).strict(),
]);
export const saveBrandEmailSettingValidationSchema = z.object({ body: emailProviderConfigurationSchema });
export const sendBrandTestEmailValidationSchema = z.object({ body: z.object({ recipientEmail: email }).strict() });
export const brandEmailSettingValidation = {
  saveBrandEmailSettingValidationSchema, sendBrandTestEmailValidationSchema,
  businessTest: z.object({ body: z.object({ to: email }).strict() }),
  domain: z.object({ body: z.object({ domain: z.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/) }).strict() }),
};
export type TEmailProviderConfiguration = z.infer<typeof emailProviderConfigurationSchema>;
