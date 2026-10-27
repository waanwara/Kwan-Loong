const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadEnvFile() {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        const separator = trimmed.indexOf('=');
        if (separator === -1) return;

        const key = trimmed.slice(0, separator).trim();
        const value = trimmed.slice(separator + 1).trim();
        if (key && process.env[key] === undefined) {
            process.env[key] = value;
        }
    });
}

loadEnvFile();

const bcrypt = require('bcryptjs');
const dataRoutes = require('./src/routes/dataRoutes');
const rothermelRoutes = require('./src/routes/rothermelRoutes');
const { findUserByEmail, findUserById, initializeDatabase } = require('./src/db');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_COOKIE = 'kwanlong_session';
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-change-this-secret';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

if (SESSION_SECRET === 'dev-only-change-this-secret') {
    console.warn('Warning: set SESSION_SECRET in production.');
}

initializeDatabase();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const publicDir = path.join(__dirname, 'public');

function base64UrlEncode(value) {
    return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
    return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(value) {
    return crypto
        .createHmac('sha256', SESSION_SECRET)
        .update(value)
        .digest('base64url');
}

function createSessionToken(user) {
    const payload = base64UrlEncode(JSON.stringify({
        id: user.id,
        email: user.email,
        name: user.name,
        exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000
    }));

    return `${payload}.${sign(payload)}`;
}

function parseCookies(cookieHeader = '') {
    return cookieHeader.split(';').reduce((cookies, cookie) => {
        const [rawName, ...rawValue] = cookie.trim().split('=');
        if (!rawName) return cookies;
        cookies[rawName] = decodeURIComponent(rawValue.join('='));
        return cookies;
    }, {});
}

function getSessionUser(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;

    const [payload, signature] = token.split('.');
    if (!payload || !signature || sign(payload) !== signature) return null;

    try {
        const session = JSON.parse(base64UrlDecode(payload));
        if (!session.exp || session.exp < Date.now()) return null;

        const user = findUserById(session.id);
        if (!user || user.email !== session.email) return null;

        return { id: user.id, email: user.email, name: user.name };
    } catch {
        return null;
    }
}

function requireAuth(req, res, next) {
    const user = getSessionUser(req);
    if (!user) {
        return res.redirect('/index.html');
    }

    req.user = user;
    next();
}

function requireApiAuth(req, res, next) {
    const user = getSessionUser(req);
    if (!user) {
        return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });
    }

    req.user = user;
    next();
}

function setSessionCookie(res, token) {
    const cookieParts = [
        `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
        'HttpOnly',
        'SameSite=Lax',
        'Path=/',
        `Max-Age=${SESSION_MAX_AGE_SECONDS}`
    ];

    if (COOKIE_SECURE) {
        cookieParts.push('Secure');
    }

    res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

// Route การ Login
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'กรุณากรอก Email และ Password' });
    }

    // ค้นหาพนักงานจากไฟล์ที่ดึงเข้ามา
    const normalizedEmail = email.trim().toLowerCase();
    const user = findUserByEmail(normalizedEmail);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Email หรือ Password ไม่ถูกต้อง' });
    }

    // ตรวจสอบรหัสผ่านด้วย bcrypt hash
    if (!bcrypt.compareSync(password, user.passwordHash)) {
        return res.status(401).json({ success: false, message: 'Email หรือ Password ไม่ถูกต้อง' });
    }

    const sessionToken = createSessionToken(user);
    setSessionCookie(res, sessionToken);

    return res.status(200).json({
        success: true,
        message: 'เข้าสู่ระบบสำเร็จ!',
        user: { id: user.id, email: user.email, name: user.name }
    });
});

app.get('/api/me', (req, res) => {
    const user = getSessionUser(req);
    if (!user) {
        return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });
    }

    return res.json({ success: true, user });
});

app.post('/api/logout', (req, res) => {
    clearSessionCookie(res);
    return res.json({ success: true, message: 'ออกจากระบบสำเร็จ' });
});

app.use('/api/rothermel', requireApiAuth, rothermelRoutes);
app.use('/api/data', requireApiAuth, dataRoutes);

app.get('/page.html', requireAuth, (req, res) => {
    res.redirect('/aar-dashboard.html');
});

app.get('/page3.html', requireAuth, (req, res) => {
    res.redirect('/dispatch.html');
});

app.get('/command.html', requireAuth, (req, res) => {
    res.redirect('/dashboard.html#command');
});

app.get('/strategic.html', requireAuth, (req, res) => {
    res.redirect('/dashboard.html#strategic');
});

app.get('/aar.html', requireAuth, (req, res) => {
    res.redirect('/dashboard.html#aar');
});

app.get(['/dashboard.html', '/aar-dashboard.html', '/dispatch.html'], requireAuth, (req, res) => {
    res.sendFile(path.join(publicDir, path.basename(req.path)));
});

app.use(express.static(publicDir, {
    index: false,
    extensions: false
}));

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
