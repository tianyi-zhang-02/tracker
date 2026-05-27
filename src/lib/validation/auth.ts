import { z } from 'zod';

export const sendOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});
export type SendOtpInput = z.infer<typeof sendOtpSchema>;

export const verifyOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  // Supabase email OTPs are six digits, but we accept up to 10 in case the
  // template gets customized later. Strict regex prevents anything weird.
  token: z
    .string()
    .trim()
    .regex(/^\d{6,10}$/, 'token must be 6–10 digits'),
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
