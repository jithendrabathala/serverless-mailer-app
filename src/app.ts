import { Hono } from 'hono';
import { cors } from 'hono/cors';
import nodemailer from 'nodemailer';
import { z } from 'zod';

export const app = new Hono();

// Middlewares
app.use('*', cors());

// Authentication Middleware
app.use('/send', async (c, next) => {
  const envVars = (c.env || {}) as Record<string, string>;
  const apiKey = envVars.MAILER_API_KEY || process.env.MAILER_API_KEY;
  const authHeader = c.req.header('Authorization');

  if (apiKey) {
    if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
      return c.json({ error: 'Unauthorized: Invalid or missing API key' }, 401);
    }
  }

  await next();
});

// Health check endpoint
app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'mailer' });
});

// Schema for sending emails
const SendEmailSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]),
  subject: z.string().min(1, 'Subject is required'),
  html: z.string().optional(),
  text: z.string().optional(),
  from: z.string().optional(),
  replyTo: z.string().email().optional(),
}).refine(data => data.html || data.text, {
  message: 'Either html or text content must be provided',
});

// Create Nodemailer Transporter function
function getTransporter(env: Record<string, any>) {
  const host = env.SMTP_HOST || process.env.SMTP_HOST;
  const port = Number(env.SMTP_PORT || process.env.SMTP_PORT || 587);
  const secure = (env.SMTP_SECURE || process.env.SMTP_SECURE) === 'true';
  const user = env.SMTP_USER || process.env.SMTP_USER;
  const pass = env.SMTP_PASS || process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP configuration missing: SMTP_HOST, SMTP_USER, and SMTP_PASS are required');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  });
}

// POST /send endpoint
app.post('/send', async (c) => {
  try {
    const body = await c.req.json();
    const parseResult = SendEmailSchema.safeParse(body);

    if (!parseResult.success) {
      return c.json({ error: 'Validation error', details: parseResult.error.flatten() }, 400);
    }

    const { to, subject, html, text, from, replyTo } = parseResult.data;
    const envVars = (c.env || {}) as Record<string, string>;
    const defaultFrom = envVars.FROM_EMAIL || process.env.FROM_EMAIL || process.env.SMTP_USER;

    let transporter;
    try {
      transporter = getTransporter(c.env || {});
    } catch (configErr: any) {
      return c.json({ error: 'Server configuration error', message: configErr.message }, 500);
    }

    const info = await transporter.sendMail({
      from: from || defaultFrom,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      html: html || undefined,
      text: text || undefined,
      replyTo: replyTo || undefined,
    });

    return c.json({ success: true, messageId: info.messageId });
  } catch (err: any) {
    return c.json({ error: 'Failed to send email', message: err?.message || String(err) }, 500);
  }
});
