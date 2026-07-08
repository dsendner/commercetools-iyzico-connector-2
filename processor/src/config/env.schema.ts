import z from "zod";

export const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production']).default('production'),
    PORT: z.string().min(4).max(4),
    LOG_LEVEL : z.enum(['debug', 'info', 'warn', 'error']).default('debug'),


    CTP_PROJECT_KEY : z.string().min(1),
    CTP_CLIENT_ID: z.string().min(1),
    CTP_CLIENT_SECRET: z.string().min(1),
    CTP_AUTH_URL: z.string().url(),
    CTP_API_URL: z.string().url(),
    CTP_SESSION_URL: z.string().url(),
    CTP_CHECKOUT_URL: z.string().url(),
    CTP_JWKS_URL: z.string().url(),
    CTP_JWT_ISSUER: z.string().min(1),

    IYZICO_BASE_URL: z.string().url(),
    IYZICO_API_KEY: z.string().min(1),
    IYZICO_SECRET_KEY: z.string().min(1),
    IYZICO_TIMEOUT: z.number().positive().default(30000),
});


export type Env = z.infer<typeof envSchema>;