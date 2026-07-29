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

        console.log(`[Auth] Token source selected:`, tokenSource || 'None');

        if (!token) {
            return res.status(401).json({ error: 'Unauthorized: No session token provided' });
        }

        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            console.error(`[Auth] Token validation failed. Error:`, error?.message);
            // If the cookie token failed, but we also have an auth header, we might want to try the auth header!
            if (tokenSource.startsWith('cookie') && hasAuthHeader) {
                console.log(`[Auth] Cookie token failed, attempting fallback to Auth header...`);
                const fallbackToken = req.headers.authorization.split(' ')[1];
                if (fallbackToken && fallbackToken !== token) {
                    const { data: fallbackData, error: fallbackError } = await supabase.auth.getUser(fallbackToken);
                    if (!fallbackError && fallbackData?.user) {
                        console.log(`[Auth] Fallback to Auth header succeeded!`);
                        req.user = fallbackData.user;
                        return next();
                    }
                }
            }
            return res.status(401).json({ error: 'Unauthorized: Invalid session token' });
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
