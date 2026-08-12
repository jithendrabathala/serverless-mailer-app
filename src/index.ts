import { serve } from '@hono/node-server';
import 'dotenv/config';
import { app } from './app.js';

const port = Number(process.env.PORT) || 3000;

console.log(`Mailer app running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
