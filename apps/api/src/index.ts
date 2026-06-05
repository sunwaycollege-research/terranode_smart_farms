/**
 * TERANODE Express API — REST + WebSocket entry point (spec §5).
 *
 * Builds the Express app, wraps it in an http.Server, mounts the real auth
 * router plus the per-feature route stubs (filled in Phase 3), attaches the
 * `/live` WebSocket server (fan-out filled in Phase 4), and listens on PORT.
 *
 * This file is OWNED by unit 2.3 and FROZEN after Phase 2 — feature units add
 * their handlers inside their own route/service files, not here.
 *
 * Run:    npm run -w @teranode/api dev      (tsx watch)
 * Health: GET http://localhost:4000/healthz
 */
import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';

import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { farmsRouter } from './routes/farms';
import { zonesRouter } from './routes/zones';
import { actuatorsRouter } from './routes/actuators';
import { rulesRouter } from './routes/rules';
import { alertsRouter } from './routes/alerts';
import { harvestRouter } from './routes/harvest';
import { cropsRouter } from './routes/crops';
import { analyticsRouter } from './routes/analytics';
import { deviceCatalogRouter } from './routes/deviceCatalog';
import { provisionRouter } from './routes/provision';
import { attachWebsocket } from './ws';
import { errorHandler, notFoundHandler } from './middleware/error';

const app = express();

// CORS: comma-separated origins from CORS_ORIGIN; allow any (reflect) in dev
// when unset so Expo web (random port) + RN dev client (LAN IP) can connect.
const corsOrigin = process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()) ?? true;
// credentials:true so browsers send/receive the httpOnly refresh cookie on /auth/*.
// (With credentials, the allowed origin is reflected per-request, never '*'.)
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json());

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'teranode-api' });
});

// --- routes ------------------------------------------------------------------
app.use('/auth', authRouter); // /auth/* + /me + /me/entitlements
app.use('/admin', adminRouter);
app.use('/farms', farmsRouter);
app.use('/zones', zonesRouter);
app.use('/actuators', actuatorsRouter);
app.use('/rules', rulesRouter);
app.use('/alerts', alertsRouter);
app.use('/harvest', harvestRouter);
app.use('/crops', cropsRouter);
app.use('/analytics', analyticsRouter);
app.use('/device-catalog', deviceCatalogRouter);
app.use('/provision', provisionRouter); // device-facing (serial+secret), no JWT

// /me + /me/entitlements live on the auth router but are mounted at root too,
// so clients can hit GET /me and GET /me/entitlements per spec §5.
app.use('/', authRouter);

// --- 404 + error handlers (must be last) -------------------------------------
app.use(notFoundHandler);
app.use(errorHandler);

// --- http server + websocket -------------------------------------------------
const server = http.createServer(app);
attachWebsocket(server);

const PORT = Number(process.env.PORT ?? 4000);
server.listen(PORT, () => {
  console.log(`teranode-api listening on http://localhost:${PORT}  (ws: /live)`);
});

export { app, server };
