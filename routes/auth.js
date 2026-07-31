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

        const expiresIn = 3 * 60 * 60 * 1000; // 3 hours
        // Set the token as a cookie
        res.cookie('session', access_token, {
            maxAge: expiresIn,
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
    res.clearCookie('session');
    res.json({ status: 'success' });
});

const authenticateToken = async (req, res, next) => {
    try {
        const cookieKeys = Object.keys(req.cookies || {});
        const hasAuthHeader = !!req.headers.authorization;
        console.log(`[Auth] Request to ${req.path}`);
        console.log(`[Auth] Cookies present:`, cookieKeys);
        console.log(`[Auth] Auth header exists:`, hasAuthHeader);
        console.log(`[Auth Debug] Raw Authorization Header Length: ${req.headers.authorization?.length || 0}`);
        if (hasAuthHeader) {
            console.log(`[Auth Debug] Auth Header Prefix: ${req.headers.authorization.substring(0, 15)}...`);
        }
        
        let token = null;
        let tokenSource = null;

        // 1. Check for custom session cookie
        if (req.cookies?.session) {
            token = req.cookies.session;
            tokenSource = 'cookie:session';
        }

        // 2. Check for standard Supabase cookie chunk 0
        if (!token) {
            const supabaseCookieKey = cookieKeys.find(k => k.startsWith('sb-') && k.endsWith('-auth-token.0'));
            const supabaseBaseCookieKey = cookieKeys.find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
            
            if (supabaseCookieKey && req.cookies[supabaseCookieKey]) {
                try {
                    // It's usually a JSON string containing the access_token, but it could be chunked.
                    // If it's standard Next.js Supabase, it might just be the string or JSON.
                    // For safety, let's just use it if it's parseable. But typically, we just use the access_token.
                    const parsed = JSON.parse(req.cookies[supabaseCookieKey]);
                    if (parsed?.access_token) {
                        token = parsed.access_token;
                        tokenSource = `cookie:${supabaseCookieKey}`;
                    }
                } catch (e) {
                    // not json
                }
            } else if (supabaseBaseCookieKey && req.cookies[supabaseBaseCookieKey]) {
                try {
                    const parsed = JSON.parse(req.cookies[supabaseBaseCookieKey]);
                    if (parsed?.access_token) {
                        token = parsed.access_token;
                        tokenSource = `cookie:${supabaseBaseCookieKey}`;
                    } else if (Array.isArray(parsed) && parsed[0]) {
                        token = parsed[0]; // access_token is typically first in the array for older supabase-js
                        tokenSource = `cookie:${supabaseBaseCookieKey}`;
                    }
                } catch (e) {}
            }
        }

        // 3. Fallback to Authorization Bearer header
        if (!token && hasAuthHeader) {
            token = req.headers.authorization.split(' ')[1];
            tokenSource = 'header:authorization';
        }

        console.log("[Auth] Credential metadata", {
            tokenSource: tokenSource || "none",
            tokenExists: Boolean(token),
            tokenLength: typeof token === "string" ? token.length : 0,
            authorizationHeaderExists: Boolean(req.headers.authorization),
            sessionCookieExists: Boolean(req.cookies?.session),
        });

        if (!token) {
            return res.status(401).json({ error: 'Unauthorized: No session token provided' });
        }

        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            const tokenText = typeof token === "string" ? token : "";
            const tokenParts = tokenText.split(".");

            console.error("[Auth] Token validation failed", {
                message: error?.message ?? null,
                code: error?.code ?? null,
                status: error?.status ?? null,
                name: error?.name ?? null,

                tokenExists: Boolean(tokenText),
                tokenLength: tokenText.length,
                jwtPartCount: tokenParts.length,
                looksLikeJwt: tokenParts.length === 3,
                hasLeadingWhitespace: /^\s/.test(tokenText),
                hasTrailingWhitespace: /\s$/.test(tokenText),
                containsBearerPrefix: tokenText.startsWith("Bearer "),
                selectedTokenSource: tokenSource,

                supabaseUrlHost: (() => {
                    try {
                        return new URL(process.env.SUPABASE_URL).hostname;
                    } catch {
                        return "INVALID_URL";
                    }
                })(),

                supabaseUrlLength: process.env.SUPABASE_URL?.length ?? 0,
                serviceKeyExists: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
                serviceKeyLength: process.env.SUPABASE_SERVICE_ROLE_KEY?.length ?? 0,
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
