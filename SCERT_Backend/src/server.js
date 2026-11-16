
const cluster = require("cluster");

if (cluster.isPrimary) {
  // Worker count and pool size are derived together in one place so they
  // can never drift out of step with the database's max_connections.
  // See src/config/dbCapacity.js.
  require("dotenv").config({ quiet: true });
  const dbCapacity = require("./config/dbCapacity");
  const numCPUs = dbCapacity.CLUSTER_WORKERS;

  console.log(`🧠 Master ${process.pid} running`);
  console.log(`🚀 Forking ${numCPUs} workers`);
  console.log(`🔌 ${dbCapacity.describe()}`);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker, code, signal) => {
    console.error(
      `❌ Worker ${worker.process.pid} died. Restarting...`
    );
    cluster.fork();
  });

  // ✅ Run cron only in primary — not in each worker
  require("./cron/sessionCron");

} else {




  require("dns").setDefaultResultOrder("ipv4first");
  require("dotenv").config();
  process.env.NODE_ENV = process.env.NODE_ENV || "dev";
  const express = require("express");
  const cors = require("cors");
  const compression = require("compression");
  const pool = require("./config/db");
  const authRoutes = require("./routes/auth.routes");
  const studentRoutes = require("./routes/student.routes");
  const scertRoutes = require("./routes/scert.routes");
  const schoolRoutes = require("./routes/school.routes");
  const beoRoutes = require("./routes/beo.routes");
  const districtRoutes = require("./routes/district.routes");
  const scertScholarshipRoutes = require("./routes/scert.scholarship.routes");
  const scertFormRoutes = require("./routes/scert.form.routes");
  const scholarshipPublicRoutes = require("./routes/scholarship.public.routes");
  const sharedMetaRoutes = require("./routes/shared.meta.routes");
  const applicationRoutes = require("./routes/student.applicationAnswer.routes");
  const schoolApplicationRoutes = require("./routes/school.application.routes");
  const applicationAnswerRoutes = require("./routes/student.applicationAnswer.routes");
  const beoApplicationRoutes = require("./routes/beo.application.routes");
  const beoCenterRoutes = require("./routes/beo.center.routes");
  const studentPublicRoutes = require("./routes/student.public.routes");
  const publicStudentAccessRoutes = require("./routes/public.studentAccess.routes");
  const enforceStudentAccess = require("./middleware/enforceStudentAccess");
  const beoAssignmentRoutes = require("./routes/beo.assignment.routes");
  const scertApplicationRoutes = require("./routes/scert.application.routes");
  const scertNominalRollRoutes = require("./routes/scert.nominalroll.routes");
  const admitCardRoutes = require("./routes/admitCard.routes");
  const admitCardPublicRoutes = require("./routes/admitCard.public.routes");
  const schoolsRegistryRoutes = require("./routes/schools.registry.routes");
  const publicVisitorRoutes = require("./routes/public.visitor.routes");
  const publicCmsRoutes = require("./routes/public.cms.routes");
  const scertCmsRoutes = require("./routes/scert.cms.routes");
  const resultRoutes = require("./routes/result.routes");
  const resultPublicRoutes = require("./routes/result.public.routes");
  const app = express();
  const verifyToken = require("./middleware/verifyToken");
  const requireRole = require("./middleware/requireRole");
  const resolveSessionContext = require("./middleware/resolveSessionContext");
  const blockPastSessionWrites = require("./middleware/blockPastSessionWrites");
  const apiTimer = require("./middleware/apiTimer");


  /**
   * 1) Keep this list exact (protocol + host + port).
   *    No wildcards when credentials are enabled.
   */
  const allowedOrigins = new Set([
    "https://scholarshipscert.uk.gov.in",
    "https://10.67.169.129",
    "http://10.67.169.129",
    "http://localhost:5173",
    "http://localhost:5000",
    "http://localhost:4000",
  ]);

  /**
   * 2) Strict origin checker
   *    - Blocks unknown origins
   *    - Handles malformed origins safely
   *    - Allows server-to-server only if you explicitly want it
   */
  function isAllowedOrigin(origin) {
    try {
      // Normalize (guards against weird inputs)
      const url = new URL(origin);
      const normalized = `${url.protocol}//${url.host}`; // no trailing slash
      return allowedOrigins.has(normalized);
    } catch {
      return false;
    }
  }

  const corsOptions = {
    origin: (origin, callback) => {
      // Decide your policy for non-browser requests:
      // OPTION A (stricter): block them
      // if (!origin) return callback(new Error("Origin required"), false);

      // OPTION B (common): allow server-to-server tools (curl, internal services)
      if (!origin) return callback(null, true);

      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }

      // Minimal logging to avoid noise (cluster-friendly)
      console.error("❌ CORS blocked:", origin);
      return callback(new Error("Not allowed by CORS"), false);
    },

    // Credentials require a specific origin (no '*')
    credentials: true,

    // Let the library reflect requested headers/methods.
    // (Avoid hard-coding unless you have a strict contract)
    // methods: undefined,
    // allowedHeaders: undefined,

    // Cache preflight for 10 minutes (reduces OPTIONS spam)
    maxAge: 600,
  };

  /**
   * 3) Apply once, at the top (before routes)
   */
  app.use(cors(corsOptions));

  /**
   * gzip every response big enough to be worth it.
   *
   * Report and result payloads are large, repetitive JSON (a result page is
   * 50 rows x 33 columns), which compresses extremely well — typically to
   * a fifth of its size or better. Placed before the routes so it wraps
   * every handler, including the streamed PDF/XLSX downloads.
   *
   * threshold skips tiny bodies, where the CPU cost of compressing would
   * outweigh the transfer saving. The x-no-compression opt-out is the
   * library's documented escape hatch, kept for debugging.
   */
  app.use(
    compression({
      threshold: 1024,
      filter: (req, res) => {
        if (req.headers["x-no-compression"]) return false;
        return compression.filter(req, res);
      },
    })
  );

  /**
   * 4) Ensure preflight is handled without using "*" routes
   *    (works with newer path-to-regexp stacks)
   */
  app.use((req, res, next) => {
    if (req.method === "OPTIONS") {
      return cors(corsOptions)(req, res, next);
    }
    next();
  });

  /**
   * 5) Trust proxy (needed behind Nginx/Apache/ELB)
   */
  app.set("trust proxy", 1);

  /**
   * 6) Sensitive response caching disabled (good practice)
   */
  const noStoreSensitiveResponses = (req, res, next) => {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, private"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
  };
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // ✅ Request timeout — kills requests that take
  // longer than 15 seconds. Prevents request
  // accumulation (thundering herd) during
  // pool exhaustion or server overload.
  app.use((req, res, next) => {
    res.setTimeout(120000, () => {
      if (!res.headersSent) {
        res.status(503).json({
          message: "Server busy. Please try again."
        });
      }
    });
    next();
  });

  // Enforce HTTPS in production only, so local HTTP development keeps working.
  app.use((req, res, next) => {
    if (process.env.NODE_ENV !== "production") {
      return next();
    }

    const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim()
      .toLowerCase();

    if (req.secure || forwardedProto === "https") {
      return next();
    }

    return res.status(400).json({ message: "HTTPS is required." });
  });

  // Clickjacking protection
  app.use((req, res, next) => {
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim()
      .toLowerCase();
    const isSecureRequest = req.secure || forwardedProto === "https";

    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none';"
    );
    if (isSecureRequest) {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains"
      );
    }
    res.setHeader(
      "Permissions-Policy",
      "geolocation=(), microphone=(), camera=()"
    );
    next();
  });


  app.use(apiTimer);

  /* Serve uploaded files */
  const path = require("path");
  const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, "../uploads");
  app.use("/api/uploads", express.static(uploadsDir));
  app.use("/api/uploads", (req, res) => res.status(404).json({ message: "File not found" }));
  // Backward compatibility for legacy URLs that used /uploads/*
  app.use("/uploads", express.static(uploadsDir));
  app.use("/uploads", (req, res) => res.status(404).json({ message: "File not found" }));


  /* All Routes */
  app.use("/api/auth", noStoreSensitiveResponses);
  app.use("/api/auth", authRoutes);

  app.use("/api/student", studentPublicRoutes);
  const publicRateLimiter = require("./middleware/publicRateLimiter");
  app.use("/api/public", publicRateLimiter);
  app.use("/api/public", admitCardPublicRoutes);
  app.use("/api/public", publicVisitorRoutes);
  app.use("/api/public", publicStudentAccessRoutes);
  app.use("/api/public", publicCmsRoutes);
  // Score cards are personal data — never let a proxy or the browser
  // cache the response, even though the endpoint itself is public.
  app.use("/api/public/results", noStoreSensitiveResponses);
  app.use("/api/public", resultPublicRoutes);


  app.use(verifyToken);           // ✅ JWT verification
  app.use(enforceStudentAccess);  // ✅ Students are refused while SCERT has Student Access switched off
  app.use(noStoreSensitiveResponses); // ✅ Prevent caching of authenticated responses
  app.use(resolveSessionContext);    // ✅ Resolve academic session
  app.use(blockPastSessionWrites);   // ✅ Block past session writes

  app.use("/api", sharedMetaRoutes);
  app.use("/api", schoolsRegistryRoutes);
  app.use("/api/student", studentRoutes);
  app.use("/api/scert", requireRole(5), scertRoutes);
  app.use("/api/school", schoolRoutes);
  app.use("/api/beo", beoRoutes);
  app.use("/api/district", districtRoutes);
  app.use("/api/scert", requireRole(5), scertScholarshipRoutes);
  app.use("/api/scert", requireRole(5), scertFormRoutes);
  app.use("/api", scholarshipPublicRoutes);
  app.use("/api", schoolApplicationRoutes);
  app.use("/api", applicationAnswerRoutes);
  app.use("/api/beo", beoApplicationRoutes);
  app.use("/api/beo", beoCenterRoutes);
  app.use("/api", beoAssignmentRoutes);
  app.use("/api/scert", requireRole(5), scertApplicationRoutes);
  app.use("/api/scert", requireRole(5), scertNominalRollRoutes);
  app.use("/api/scert", requireRole(5), scertCmsRoutes);



  app.use("/api", admitCardRoutes);
  app.use("/api/results", resultRoutes);




  /* Health Check */
  app.get("/health", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      console.log("✅ DB connection OK");
      res.status(200).json({
        status: "OK",
        message: "Server and Database are connected",
      });
    } catch (error) {
      console.error("❌ DB connection failed:", error.message);
      res.status(500).json({
        status: "ERROR",
        message: "Database connection failed",
      });
    }
  });

  app.use((err, req, res, next) => {
    const statusCode = Number.isInteger(err?.statusCode)
      ? err.statusCode
      : Number.isInteger(err?.status)
        ? err.status
        : 500;

    console.error("Unhandled API error:", {
      message: err?.message,
      stack: err?.stack,
      path: req.originalUrl,
      method: req.method,
    });

    if (res.headersSent) {
      return next(err);
    }

    return res.status(statusCode).json({ message: "Internal server error" });
  });


  (async () => {
    try {
      const client = await pool.connect();
      await client.query("SELECT 1");
      client.release();
      console.log("🔥 DB pool warmed up and ready");
    } catch (err) {
      console.error("❌ DB warm-up failed:", err.message);
      process.exit(1);
    }
  })();


  /* Start Server */
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
  });

}
