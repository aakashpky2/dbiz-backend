const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const cookieParser = require('cookie-parser');
const compression = require('compression');

// ==========================================
// 1. GLOBAL ERROR HANDLING
// ==========================================
process.on('uncaughtException', (err) => {
    console.error(' [FATAL] Uncaught Exception:', err.message);
    console.error(err.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(' [FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// ==========================================
// 2. ENVIRONMENT CONFIGURATION
// ==========================================
// Try multiple locations for development, but in production Render uses Dashboard env vars
const envPaths = [
    path.join(__dirname, '.env'),
    path.join(__dirname, '../.env'),
    path.join(__dirname, '../frontend/.env.local')
];

for (const envPath of envPaths) {
    dotenv.config({ path: envPath });
}

function validateEnv() {
  const required = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];

  const missing = required.filter(
    (key) => !process.env[key]?.trim()
  );

  if (missing.length > 0) {
    console.error(
      `[FATAL] Missing required environment variables: ${missing.join(", ")}`
    );
    console.error(
      "Set these variables in the hosting provider environment settings."
    );

    process.exit(1);
  }

  console.log("[Startup] Environment validated");
}

validateEnv();

const app = express();

// ==========================================
// 3. MIDDLEWARE
// ==========================================
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});
const allowedOrigins = [
    process.env.FRONTEND_URL,
    ...(process.env.ADDITIONAL_ALLOWED_ORIGINS ? process.env.ADDITIONAL_ALLOWED_ORIGINS.split(',') : []),
    ...(process.env.NODE_ENV === 'development' ? [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:3004'
    ] : [])
].filter(Boolean);

const corsOptions = {
    origin: function (origin, callback) {
        // Allow server-to-server requests, health checks, direct API checks where origin is undefined
        if (!origin) {
            return callback(null, true);
        }

        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        console.error("[CORS] Blocked origin:", origin);
        return callback(new Error(`Not allowed by CORS: ${origin}`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));
app.use(cookieParser());
app.use(compression());

// In-memory Rate Limiting Middleware
const rateLimits = new Map();
const rateLimiter = (limit, windowMs) => {
    return (req, res, next) => {
        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const now = Date.now();
        if (!rateLimits.has(ip)) {
            rateLimits.set(ip, []);
        }
        const timestamps = rateLimits.get(ip).filter(t => now - t < windowMs);
        if (timestamps.length >= limit) {
            return res.status(429).json({ success: false, message: 'Too many requests. Please try again later.' });
        }
        timestamps.push(now);
        rateLimits.set(ip, timestamps);
        next();
    };
};

// Health Check Handlers
const healthHandler = (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'dbiz-app-backend',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
};

app.get("/", healthHandler);
app.get("/health", healthHandler);
app.get("/api/health", healthHandler);

// Apply IP Rate Limiters
app.use('/api', rateLimiter(1500, 15 * 60 * 1000)); // Max 1500 requests per 15 mins globally
app.use('/api/auth/login', rateLimiter(20, 15 * 60 * 1000)); // Strict 20 requests per 15 mins for login
app.use('/api/auth/register', rateLimiter(20, 15 * 60 * 1000));
app.use('/api/password-reset', rateLimiter(20, 15 * 60 * 1000));

// Apply JWT authentication validation middleware globally on API routes
const { authenticateToken } = require('./routes/auth');
const publicApiPaths = new Set([
  "/health",
  "/time",
  "/auth/login",
]);

app.use("/api", (req, res, next) => {
  if (publicApiPaths.has(req.path)) {
    return next();
  }

  return authenticateToken(req, res, next);
});

console.log(' [Init] Middleware and rate limiters configured');

// ==========================================
// ==========================================
// 4. ROUTE REGISTRATION
// ==========================================
const routeManifest = require('./config/route-manifest');

console.log(' [Init] Importing and mounting routes...');

function resolveRouter(definition, loadedModule) {
  const router = definition.exportName
    ? loadedModule[definition.exportName]
    : loadedModule;

  if (!router || typeof router !== "function") {
    throw new TypeError(
      `Route "${definition.name}" did not export a valid Express router`
    );
  }

  return router;
}

for (const definition of routeManifest) {
    try {
        console.log(`[RouteLoader] Loading ${definition.name}`);
        const loadedModule = require(definition.modulePath);
        const router = resolveRouter(definition, loadedModule);
        app.use(definition.mountPath, router);
        console.log(`[RouteLoader] Mounted ${definition.name} at ${definition.mountPath}`);
    } catch (error) {
        console.error(`[FATAL] Failed to load route: ${definition.name}`);
        console.error(`Module path: ${definition.modulePath}`);
        console.error(`Error message: ${error.message}`);
        console.error(`Full stack: ${error.stack}`);
        process.exit(1);
    }
}
console.log(' [Init] Routes mounted successfully');

// Global Error Handler to ensure JSON responses
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

app.use((err, req, res, next) => {
  console.error("[ERROR]", err.message);
  console.error(err.stack);

  if (res.headersSent) {
    return next(err);
  }

  return res.status(err.status || 500).json({
    success: false,
    message:
      process.env.NODE_ENV === "production"
        ? "Internal Server Error"
        : err.message || "Unknown Error",
  });
});

// ==========================================
// 5. SERVER STARTUP
// ==========================================
const PORT = Number(
  process.env.PORT ||
  process.env.BACKEND_PORT ||
  3001
);

const HOST = process.env.HOST || "0.0.0.0";

if (!Number.isInteger(PORT) || PORT <= 0) {
  console.error("[FATAL] Invalid server port");
  process.exit(1);
}

const server = app.listen(PORT, HOST, () => {
  console.log("[Startup] Routes mounted");
  console.log(`[Startup] Backend listening on ${HOST}:${PORT}`);
});

server.on("error", (error) => {
  console.error("[FATAL] Server failed to start:", error.message);
  console.error(error.stack);
  process.exit(1);
});


 
