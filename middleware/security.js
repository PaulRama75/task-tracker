const helmet = require('helmet');
const cors = require('cors');
const config = require('../config');

function setupSecurity(app) {
  // Remove X-Powered-By header
  app.disable('x-powered-by');

  // Apply helmet with explicit CSP directives and HSTS
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"]
      }
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true
    }
  }));

  // Apply CORS using config.corsOrigin (false = same-origin only)
  app.use(cors({
    origin: config.corsOrigin,
    credentials: true
  }));
}

module.exports = { setupSecurity };
