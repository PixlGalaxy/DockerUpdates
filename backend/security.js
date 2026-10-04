// HTTP hardening: security headers, strict same-origin policy (no CORS), input checks.
import helmet from 'helmet';
import { audit } from './auth.js';

/** Extra origins allowed to call the API, e.g. "https://docker.example.com" (normally not needed). */
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),
);

/**
 * Proxies whose X-Forwarded-* headers are trusted (for the client IP and HTTPS detection).
 * Set TRUST_PROXY to the Nginx Proxy Manager IP so other LAN hosts cannot spoof them.
 */
export function trustProxySetting() {
  const v = process.env.TRUST_PROXY?.trim();
  if (!v) return 'loopback, linklocal, uniquelocal';
  if (v === 'false') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // style="" attributes (progress bars) + Google Fonts stylesheet
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      // Icon URL preview in the editor may point to any https/http image
      imgSrc: ["'self'", 'data:', 'https:', 'http:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'same-origin' },
  // Only honoured by browsers over HTTPS (i.e. through Nginx Proxy Manager)
  strictTransportSecurity: { maxAge: 180 * 24 * 3600, includeSubDomains: false },
  xFrameOptions: { action: 'deny' },
});

export function permissionsPolicy(_req, res, next) {
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  next();
}

function originOf(req) {
  const origin = req.get('origin');
  if (origin && origin !== 'null') return origin;
  const referer = req.get('referer');
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/**
 * Same-origin only API (no CORS): never sends Access-Control-* headers, rejects preflights,
 * cross-site fetches and state-changing requests whose Origin is not this app.
 * This also stops CSRF from sibling subdomains behind the same proxy (SameSite=Strict
 * alone treats *.example.com as "same site").
 */
export function sameOriginOnly(req, res, next) {
  if (req.method === 'OPTIONS') return res.status(403).json({ error: 'CORS is not allowed' });
  if (req.get('sec-fetch-site') === 'cross-site') {
    return res.status(403).json({ error: 'Cross-site requests are not allowed' });
  }
  if (['GET', 'HEAD'].includes(req.method)) return next();

  const origin = originOf(req);
  if (!origin) return res.status(403).json({ error: 'Missing Origin header' });
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    return res.status(403).json({ error: 'Invalid Origin header' });
  }
  // Host is set by the client/proxy (NPM forwards it as-is); X-Forwarded-Host is ignored
  // because any client could send it.
  if (host !== req.get('host') && !ALLOWED_ORIGINS.has(origin)) {
    audit(req, `blocked ${req.method} ${req.path} from origin ${origin}`);
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  next();
}

/** Container references accepted by the API (ID or name): blocks path tricks like "../images". */
export function validContainerRef(req, res, next, value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value)) {
    return res.status(400).json({ error: 'Invalid container id' });
  }
  next();
}

/** Logs every state-changing API call (who, what, result). */
export function auditLog(req, res, next) {
  if (['GET', 'HEAD'].includes(req.method)) return next();
  res.on('finish', () => {
    audit(req, `user="${req.user ?? '-'}" ${req.method} ${req.originalUrl} -> ${res.statusCode}`);
  });
  next();
}
