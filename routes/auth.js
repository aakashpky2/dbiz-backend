const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');

router.post('/login', async (req, res) => {
    try {
        const { access_token } = req.body;

        if (!access_token) {
            return res.status(400).json({ error: 'Missing access token' });
        }

        // Verify the token by calling getUser
        const { data: { user }, error } = await supabase.auth.getUser(access_token);

        if (error || !user) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        let exp = 0;
        try {
            const tokenParts = access_token.split('.');
            if (tokenParts.length === 3) {
                const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64url').toString('utf-8'));
                exp = payload.exp;
            }
        } catch (e) {
            return res.status(401).json({ error: 'Malformed token' });
        }

<<<<<<< HEAD
        if (!exp) {
            return res.status(401).json({ error: 'Missing expiry in token' });
=======
        if (!exp || !Number.isFinite(exp)) {
            return res.status(401).json({ error: 'Missing or malformed expiry in token' });
>>>>>>> 6d200db (Harden authentication and session handling)
        }

        const now = Math.floor(Date.now() / 1000);
        const remainingSeconds = exp - now;

        if (remainingSeconds <= 0) {
            return res.status(401).json({ error: 'Token has expired' });
        }

<<<<<<< HEAD
        const maxAgeMs = Math.max(1, remainingSeconds) * 1000;

        res.cookie('session', access_token, {
            maxAge: maxAgeMs,
=======
        const maxAge = remainingSeconds * 1000;
        // Set the token as a cookie
        res.cookie('session', access_token, {
            maxAge: maxAge,
>>>>>>> 6d200db (Harden authentication and session handling)
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            path: '/',
            sameSite: 'lax',
        });

        res.json({ status: 'success' });
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie('session', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
    });
    res.json({ status: 'success' });
});

const authenticateToken = async (req, res, next) => {
    try {
        const hasAuthHeader = !!req.headers.authorization;
        
        let token = null;
        let tokenSource = null;

        // 1. Check for custom session cookie
        if (req.cookies?.session) {
            token = req.cookies.session;
            tokenSource = 'cookie:session';
        }

        // 2. Check for standard Supabase cookie chunk 0
        if (!token) {
            const cookieKeys = Object.keys(req.cookies || {});
            const supabaseCookieKey = cookieKeys.find(k => k.startsWith('sb-') && k.endsWith('-auth-token.0'));
            const supabaseBaseCookieKey = cookieKeys.find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
            
            if (supabaseCookieKey && req.cookies[supabaseCookieKey]) {
                try {
                    const parsed = JSON.parse(req.cookies[supabaseCookieKey]);
                    if (parsed?.access_token) {
                        token = parsed.access_token;
                        tokenSource = `cookie:${supabaseCookieKey}`;
                    }
                } catch (e) {
                }
            } else if (supabaseBaseCookieKey && req.cookies[supabaseBaseCookieKey]) {
                try {
                    const parsed = JSON.parse(req.cookies[supabaseBaseCookieKey]);
                    if (parsed?.access_token) {
                        token = parsed.access_token;
                        tokenSource = `cookie:${supabaseBaseCookieKey}`;
                    } else if (Array.isArray(parsed) && parsed[0]) {
                        token = parsed[0];
                        tokenSource = `cookie:${supabaseBaseCookieKey}`;
                    }
                } catch (e) {}
            }
        }

        // 3. Fallback to Authorization Bearer header
        if (!token && hasAuthHeader) {
<<<<<<< HEAD
            if (req.headers.authorization.startsWith('Bearer ')) {
                token = req.headers.authorization.substring(7).trim();
=======
            const authHeaderValue = req.headers.authorization;
            if (authHeaderValue.startsWith('Bearer ')) {
                token = authHeaderValue.replace('Bearer ', '').trim();
>>>>>>> 6d200db (Harden authentication and session handling)
                tokenSource = 'header:authorization';
            }
        }

        console.log("[Auth] Credential metadata", {
            route: req.path,
            tokenSource: tokenSource || "none",
            tokenExists: Boolean(token),
            sessionCookieExists: Boolean(req.cookies?.session),
            authorizationHeaderExists: hasAuthHeader
        });

        if (token && typeof token === 'string') {
            token = token.trim();
        }

        if (!token) {
            return res.status(401).json({ error: 'Unauthorized: No session token provided' });
        }

        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            console.error("[Auth] Token validation failed", {
                message: error?.message ?? null,
                code: error?.code ?? null,
                status: error?.status ?? null,
                name: error?.name ?? null,
                selectedTokenSource: tokenSource,
                validationStatus: 'failed'
            });

            return res.status(401).json({
                error: "Unauthorized",
                message: "Invalid session token",
            });
        }

        req.user = user;
        next();
    } catch (err) {
        console.error('Authentication Middleware Error:', err);
        return res.status(401).json({ error: 'Unauthorized: Auth processing failed' });
    }
};

const RBACService = require('../services/rbacService');

router.get('/access-context', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const resolution = await RBACService.getUserAccessResolution(userId);
        res.json({ status: 'success', data: resolution });
    } catch (error) {
        console.error('Access Context Error:', error);
        res.status(500).json({ error: 'Failed to resolve access context' });
    }
});

module.exports = { router, authenticateToken };
// temporary test
