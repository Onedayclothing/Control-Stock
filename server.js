const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const translate = require('translate-google'); // 📦 Library សម្រាប់បកប្រែស្វ័យប្រវត្តិ

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // Serve ហ្វាល Static ធម្មតា

// 📁 កំណត់ Directory Volume លើ Railway ឬ Local Disk
const videoDir = process.env.STORAGE_PATH || path.join(__dirname, 'videos');
if (!fs.existsSync(videoDir)) {
    fs.mkdirSync(videoDir, { recursive: true });
}

// 🌐 Serve ហ្វាល Static (រូបភាព/វីដេអូ) ចេញពី Volume Directory តាម URL /videos
app.use('/videos', express.static(videoDir));

// 🌐 ផ្លូវទី ១: សម្រាប់ Website ធម្មតា (អតិថិជនចូលមើល និងកុម្មង់ទំនិញ)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 🔒 ផ្លូវទី ២: សម្រាប់ Telegram Mini App (Admin គ្រប់គ្រងស្តុក)
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ភ្ជាប់ Database ស្វ័យប្រវត្តិពី Railway
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// 🔒 Telegram Bot Setup
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('⚠️ BOT_TOKEN មិនទាន់បានកំណត់នៅក្នុង Environment Variables ទេ!');
}
const bot = new Telegraf(BOT_TOKEN || 'NO_TOKEN_PROVIDED');

const RAILWAY_HOST = process.env.RAILWAY_PUBLIC_DOMAIN 
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
    : 'https://control-stock-production-a855.up.railway.app';

// កន្លែងរក្សាទុកដំណាក់កាលបំពេញទិន្នន័យតាម Chat របស់ Admin ម្នាក់ៗ
let userStates = {};

// មុខងារពិនិត្យសិទ្ធិ Admin តាម chat_id ឬ username
async function isAdminUser(chatId, username) {
    try {
        let check = await pool.query(
            "SELECT * FROM admins WHERE chat_id = $1 OR (username != '' AND LOWER(username) = LOWER($2))",
            [chatId || 0, username || '']
        );
        return check.rows.length > 0;
    } catch (err) {
        console.error("Error checking admin:", err);
        return false;
    }
}

// មុខងារពិនិត្យថាតើ User នេះជា Owner (ម្ចាស់ហាង) មែនឬអត់
async function isOwnerUser(chatId, username) {
    try {
        let check = await pool.query(
            "SELECT * FROM admins WHERE (chat_id = $1 OR LOWER(username) = LOWER($2)) AND is_owner = TRUE",
            [chatId || 0, username || '']
        );
        return check.rows.length > 0;
    } catch (err) {
        console.error("Error checking owner:", err);
        return false;
    }
}

// មុខងារបកប្រែស្វ័យប្រវត្តិពី ខ្មែរ ទៅ EN និង ZH
async function autoTranslate(text) {
    if (!text || text.trim() === '') return { en: '', zh: '' };
    try {
        let en = await translate(text, { from: 'km', to: 'en' });
        let zh = await translate(text, { from: 'km', to: 'zh-CN' });
        return { en, zh };
    } catch (err) {
        console.error("Translation error:", err);
        return { en: text, zh: text };
    }
}

// 🛡️ Helper Function: ពិនិត្យមើលថា File (រូបភាព/វីដេអូ) កំពុងប្រើលើ Web ឬអត់មុននឹងលុប
async function isMediaInUse(fileName) {
    if (!fileName) return false;
    try {
        let prodCheck = await pool.query(
            "SELECT COUNT(*) FROM products WHERE video_url LIKE $1",
            [`%${fileName}%`]
        );
        if (parseInt(prodCheck.rows[0].count) > 0) return true;

        let settingsCheck = await pool.query(
            "SELECT COUNT(*) FROM website_settings WHERE value LIKE $1",
            [`%${fileName}%`]
        );
        if (parseInt(settingsCheck.rows[0].count) > 0) return true;

        return false;
    } catch (err) {
        console.error("Error checking media usage:", err);
        return true; // ការពារកុំឱ្យលុបប្រសិនបើមាន Error
    }
}

// 🖼️/🎥 Helper Function: ចាប់យក File Object ពីរូបភាព វីដេអូ GIF ឬ Document
function getTelegramMediaObject(msg) {
    if (msg.photo && msg.photo.length > 0) {
        return msg.photo[msg.photo.length - 1]; // ចាប់យករូបភាពដែលច្បាស់ជាងគេ
    }
    return msg.video || msg.video_note || msg.animation || msg.document || null;
}

// 📥 Helper Function ទាញយក និង Save ហ្វាល (រូបភាព ឬ វីដេអូ) ចូល Volume Disk
async function downloadAndSaveTelegramFile(ctx, fileId, prefix = 'media') {
    let linkObj = await ctx.telegram.getFileLink(fileId);
    let fileUrl = typeof linkObj === 'string' ? linkObj : (linkObj.href || linkObj.toString());
    
    // 🎯 ឆែកមើលប្រភេទ extension ឱ្យច្បាស់លាស់ (.jpg, .png, .gif, .mp4)
    let ext = '.mp4';
    if (ctx.message && ctx.message.photo && ctx.message.photo.length > 0) {
        ext = '.jpg';
    } else if (fileUrl.match(/\.(jpg|jpeg|png|gif|webp)/i)) {
        ext = fileUrl.match(/\.(jpg|jpeg|png|gif|webp)/i)[0].toLowerCase();
    } else if (fileUrl.match(/\.(mp4|mov|avi|webm)/i)) {
        ext = fileUrl.match(/\.(mp4|mov|avi|webm)/i)[0].toLowerCase();
    }

    let response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
    let arrayBuffer = await response.arrayBuffer();
    let buffer = Buffer.from(arrayBuffer);
    let fileName = `${prefix}_${Date.now()}${ext}`;
    
    fs.writeFileSync(path.join(videoDir, fileName), buffer);
    return `${RAILWAY_HOST}/videos/${fileName}`;
}

// បង្បង្កើត Table ស្តុក ផលិតផល អដ្មេន បញ្ជីខ្មៅ និង ការកុម្មង់
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS products (
                ref VARCHAR(50) PRIMARY KEY,
                title_km VARCHAR(255),
                title_en VARCHAR(255),
                title_zh VARCHAR(255),
                desc_km TEXT,
                desc_en TEXT,
                desc_zh TEXT,
                gender VARCHAR(20),
                type VARCHAR(20),
                video_url VARCHAR(255),
                price DECIMAL(10,2),
                cost_price DECIMAL(10,2) DEFAULT 0
            );
        `);

        await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS title_en VARCHAR(255);`);
        await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS title_zh VARCHAR(255);`);
        await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS desc_en TEXT;`);
        await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS desc_zh TEXT;`);
        await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price DECIMAL(10,2) DEFAULT 0;`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS stock (
                id SERIAL PRIMARY KEY,
                ref VARCHAR(50),
                size VARCHAR(10),
                stock_qty INT,
                price DECIMAL(10,2),
                UNIQUE(ref, size)
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS purchases (
                id SERIAL PRIMARY KEY,
                ref VARCHAR(50),
                size VARCHAR(10),
                qty INT,
                cost_price DECIMAL(10,2),
                total_cost DECIMAL(10,2),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS website_settings (
                key VARCHAR(100) PRIMARY KEY,
                value TEXT
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS admins (
                id SERIAL PRIMARY KEY,
                chat_id BIGINT UNIQUE,
                username VARCHAR(255),
                is_owner BOOLEAN DEFAULT FALSE
            );
        `);
        await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS username VARCHAR(255);`);
        await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS is_owner BOOLEAN DEFAULT FALSE;`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS banned_admins (
                id SERIAL PRIMARY KEY,
                chat_id BIGINT UNIQUE,
                username VARCHAR(255)
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                customer TEXT,
                items JSONB,
                total DECIMAL(10,2),
                status VARCHAR(50) DEFAULT 'PENDING',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        let checkProd = await pool.query("SELECT COUNT(*) FROM products");
        if (parseInt(checkProd.rows[0].count) === 0) {
            const initialProducts = [
                ['1', 'T-Shirt Polo Collab OneDay', 'អាវយឺត Polo រចនាម៉ូដទាន់សម័យ ងាយពាក់', 'men', 'tops', 'videos/Man_walking_in_fashion_studio_202608272139.mp4', 15.00, 0.00],
                ['2', 'Olive Green Mandarin Collar Long-Sleeve Shirt', 'អាវដៃវែងកាតគៀនពណ៌បៃតងអូលីវ ស្អាតប្រណិត', 'men', 'tops', 'videos/Model_walking_in_fashion_studio_202608272237.mp4', 6.00, 0.00],
                ['3', 'Outfit Smart Casual (Full Set)', 'ឈុតសម្លៀកបំពាក់ Smart Casual ទាន់សម័យ', 'men', 'tops', 'videos/Male_model_walking_in_studio_202608271814.mp4', 20.00, 0.00],
                ['4', 'Plaid Sailor Collar Blouse', 'អាវនារី ករសាឡាប្រណិត ស្អាតទាន់សម័យ', 'women', 'tops', 'videos/Woman_modeling_shirt_360_rotation_202609061421.mp4', 7.00, 0.00],
                ['5', 'Striped Crew Neck T-Shirt', 'អាវយឺតដៃខ្លី Casual សាមញ្ញ មានករបើកមូល និងមានម៉ូដឆ្នូតទទឹងពណ៌ត្នោតស្រាលលាយស', 'men', 'tops', 'videos/Fashion_commercial_video_production_20260911003050.mp4', 12.00, 0.00],
                ['6', 'Vertical Striped Button-Up Shirt', 'អាវដៃវែងក្រឡាមូដឆ្នូតត្រង់ សម្រាប់ធ្វើការ ទៅរៀន', 'men', 'tops', 'videos/Fashion_model_commercial_video_20260911003817.mp4', 18.00, 0.00]
            ];
            for (let prod of initialProducts) {
                let tTitle = await autoTranslate(prod[1]);
                let tDesc = await autoTranslate(prod[2]);
                await pool.query(
                    "INSERT INTO products (ref, title_km, title_en, title_zh, desc_km, desc_en, desc_zh, gender, type, video_url, price, cost_price) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (ref) DO NOTHING",
                    [prod[0], prod[1], tTitle.en, tTitle.zh, prod[2], tDesc.en, tDesc.zh, prod[3], prod[4], prod[5], prod[6], prod[7]]
                );
            }
        }

        let checkStock = await pool.query("SELECT COUNT(*) FROM stock");
        if (parseInt(checkStock.rows[0].count) === 0) {
            const initialData = [
                ['1', 'S', 10, 15.00], ['1', 'M', 15, 15.00], ['1', 'L', 12, 15.00], ['1', 'XL', 8, 15.00], ['1', 'XXL', 5, 15.00],
                ['2', 'S', 20, 6.00],  ['2', 'M', 25, 6.00],  ['2', 'L', 18, 6.00],  ['2', 'XL', 10, 6.00], ['2', 'XXL', 4, 6.00],
                ['3', 'S', 5, 20.00],  ['3', 'M', 10, 20.00], ['3', 'L', 8, 20.00],   ['3', 'XL', 6, 20.00], ['3', 'XXL', 2, 20.00],
                ['4', 'S', 15, 7.00],  ['4', 'M', 20, 7.00],  ['4', 'L', 14, 7.00],  ['4', 'XL', 9, 7.00],  ['4', 'XXL', 3, 7.00],
                ['5', 'S', 12, 12.00], ['5', 'M', 18, 12.00], ['5', 'L', 15, 12.00], ['5', 'XL', 7, 12.00], ['5', 'XXL', 4, 12.00],
                ['6', 'S', 10, 18.00], ['6', 'M', 14, 18.00], ['6', 'L', 11, 18.00], ['6', 'XL', 6, 18.00], ['6', 'XXL', 2, 18.00]
            ];
            for (let row of initialData) {
                await pool.query(
                    "INSERT INTO stock (ref, size, stock_qty, price) VALUES ($1, $2, $3, $4) ON CONFLICT (ref, size) DO NOTHING",
                    row
                );
            }
        }
        console.log("Database initialized successfully.");
    } catch (err) {
        console.error("Database initialization error:", err);
    }
}
initDB();

// --- API ENDPOINTS ---

app.get('/api/website-settings', async (req, res) => {
    try {
        let result = await pool.query("SELECT * FROM website_settings");
        let settings = {};
        result.rows.forEach(r => settings[r.key] = r.value);
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/delivery-fee', async (req, res) => {
    try {
        let result = await pool.query("SELECT value FROM website_settings WHERE key = 'delivery_fee'");
        let fee = result.rows.length > 0 ? result.rows[0].value : '2.00';
        res.json({ delivery_fee: fee });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/products', async (req, res) => {
    try {
        const query = `
            SELECT p.*, 
                   json_agg(json_build_object('size', s.size, 'stock_qty', s.stock_qty)) as sizes
            FROM products p
            LEFT JOIN stock s ON p.ref = s.ref
            GROUP BY p.ref
            ORDER BY CAST(p.ref AS INTEGER) DESC;
        `;
        let result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/stock', async (req, res) => {
    try {
        let result = await pool.query("SELECT * FROM stock ORDER BY CAST(ref AS INTEGER) ASC, size");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/check-admin', async (req, res) => {
    let { telegramId, username } = req.body;
    try {
        let authorized = await isAdminUser(telegramId, username);
        res.json({ authorized });
    } catch (err) {
        res.status(500).json({ authorized: false, error: err.message });
    }
});

app.post('/api/admin/update-stock', async (req, res) => {
    let { ref, size, qty } = req.body;
    try {
        let cleanRef = ref.replace(/ref:?\s*/i, '').trim().toUpperCase();
        let cleanSize = size.trim().toUpperCase();
        await pool.query(
            "UPDATE stock SET stock_qty = $1 WHERE UPPER(ref) = $2 AND UPPER(size) = $3",
            [qty, cleanRef, cleanSize]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/add-product', async (req, res) => {
    let { ref, title_km, desc_km, gender, type, video_url, price, initial_stock } = req.body;
    try {
        let cleanRef = String(ref).replace(/ref:?\s*/i, '').trim().toUpperCase();
        let parsedPrice = parseFloat(price) || 0;
        let parsedCost = 0;
        let defaultQty = initial_stock !== undefined ? parseInt(initial_stock) : 0;

        let tTitle = await autoTranslate(title_km);
        let tDesc = await autoTranslate(desc_km || '');

        await pool.query(
            `INSERT INTO products (ref, title_km, title_en, title_zh, desc_km, desc_en, desc_zh, gender, type, video_url, price, cost_price) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
             ON CONFLICT (ref) DO UPDATE 
             SET title_km = $2, title_en = $3, title_zh = $4, desc_km = $5, desc_en = $6, desc_zh = $7, gender = $8, type = $9, video_url = $10, price = $11, cost_price = $12`,
            [cleanRef, title_km, tTitle.en, tTitle.zh, desc_km || '', tDesc.en, tDesc.zh, gender || 'men', type || 'tops', video_url || '', parsedPrice, parsedCost]
        );

        let sizes = ['S', 'M', 'L', 'XL', 'XXL'];
        for (let size of sizes) {
            await pool.query(
                `INSERT INTO stock (ref, size, stock_qty, price) 
                 VALUES ($1, $2, $3, $4) 
                 ON CONFLICT (ref, size) DO UPDATE 
                 SET price = $4`,
                [cleanRef, size, defaultQty, parsedPrice]
            );
        }

        res.json({ success: true, message: `ទំនិញ Ref ${cleanRef} ត្រូវបានបន្ថែមជោគជ័យ!` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/order', async (req, res) => {
    let { customer, items } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        let totalAmount = 0;
        let itemsSummary = [];

        for (let key in items) {
            let item = items[key];
            let cleanRef = item.ref.replace(/ref:?\s*/i, '').trim().toUpperCase();
            let cleanSize = item.size.trim().toUpperCase();
            let qty = parseInt(item.qty) || 1;
            
            let check = await client.query(
                "SELECT s.stock_qty, p.title_km, p.price, p.cost_price FROM stock s JOIN products p ON s.ref = p.ref WHERE UPPER(s.ref) = $1 AND UPPER(s.size) = $2 FOR UPDATE",
                [cleanRef, cleanSize]
            );
            
            if (check.rows.length > 0) {
                let currentStock = check.rows[0].stock_qty;
                if (currentStock < qty) {
                    await client.query('ROLLBACK');
                    client.release();
                    return res.json({ 
                        success: false, 
                        message: `សូមអភ័យទោស! ទំនិញ Ref ${cleanRef} Size ${cleanSize} ដាច់ស្តុក!` 
                    });
                }
                let sellPrice = parseFloat(check.rows[0].price);
                let costPrice = parseFloat(check.rows[0].cost_price || 0);
                let itemTotal = sellPrice * qty;
                let itemProfit = (sellPrice - costPrice) * qty;

                totalAmount += itemTotal;
                itemsSummary.push({
                    ref: cleanRef,
                    title: check.rows[0].title_km,
                    size: cleanSize,
                    qty: qty,
                    price: sellPrice,
                    cost_price: costPrice,
                    total: itemTotal,
                    profit: itemProfit
                });
            } else {
                await client.query('ROLLBACK');
                client.release();
                return res.json({ success: false, message: `រកមិនឃើញទំនិញ Ref ${cleanRef} Size ${cleanSize} ឡើយ!` });
            }
        }

        let orderRes = await client.query(
            "INSERT INTO orders (customer, items, total, status) VALUES ($1, $2, $3, 'PENDING') RETURNING id",
            [JSON.stringify(customer || {}), JSON.stringify(itemsSummary), totalAmount]
        );
        let orderId = orderRes.rows[0].id;

        for (let key in items) {
            let item = items[key];
            let cleanRef = item.ref.replace(/ref:?\s*/i, '').trim().toUpperCase();
            let cleanSize = item.size.trim().toUpperCase();
            let qty = parseInt(item.qty) || 1;
            
            await client.query(
                "UPDATE stock SET stock_qty = stock_qty - $1 WHERE UPPER(ref) = $2 AND UPPER(size) = $3",
                [qty, cleanRef, cleanSize]
            );
        }

        await client.query('COMMIT');
        client.release();

        let adminsRes = await pool.query("SELECT chat_id FROM admins WHERE chat_id IS NOT NULL");
        if (adminsRes.rows.length > 0) {
            let custName = customer?.name || customer?.fullName || 'អតិថិជនមិនបញ្ចេញឈ្មោះ';
            let custPhone = customer?.phone || customer?.phoneNumber || 'គ្មានលេខទូរស័ព្ទ';
            let custAddress = customer?.address || customer?.location || 'គ្មានអាសយដ្ឋាន';
            let userId = customer?.userId || customer?.telegramId || '';
            let username = customer?.username || '';

            let msg = `📦 **មានការកុម្មង់ទំនិញថ្មី!** (#Order ID: ${orderId})\n\n`;
            msg += `👤 **ព័ត៌មានអតិថិជន:**\n`;
            msg += `- ឈ្មោះ: ${custName}\n`;
            msg += `- លេខទូរស័ព្ទ: ${custPhone}\n`;
            msg += `- អាសយដ្ឋាន: ${custAddress}\n`;
            if (userId) msg += `- Telegram ID: \`${userId}\`\n`;
            if (username) msg += `- Username: @${username}\n`;

            msg += `\n🛒 **ទំនិញកុម្មង់:**\n`;
            itemsSummary.forEach((it, idx) => {
                msg += `${idx + 1}. Ref: ${it.ref} - ${it.title} (Size: ${it.size}) x ${it.qty} = $${Number(it.total).toFixed(2)}\n`;
            });

            msg += `\n💵 **សរុបទឹកប្រាក់:** $${Number(totalAmount).toFixed(2)}`;

            let inlineKeyboard = [
                [
                    { text: '✅ Confirm Order', callback_data: `confirm_order_${orderId}` },
                    { text: '❌ Cancel & Restore Stock', callback_data: `cancel_order_${orderId}` }
                ]
            ];

            if (userId) {
                inlineKeyboard.push([{ text: '💬 ឆាតទៅកាន់អតិថិជន', url: `tg://user?id=${userId}` }]);
            } else if (username) {
                inlineKeyboard.push([{ text: '💬 ឆាតទៅកាន់អតិថិជន', url: `https://t.me/${username}` }]);
            }

            for (let adm of adminsRes.rows) {
                try {
                    await bot.telegram.sendMessage(adm.chat_id, msg, {
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: inlineKeyboard }
                    });
                } catch (e) {}
            }
        }

        res.json({ success: true, message: "ការកុម្មង់បានជោគជ័យ និងកាត់ស្តុកស្វ័យប្រវត្តិរួចរាល់!" });

    } catch (err) {
        await client.query('ROLLBACK');
        client.release();
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- TELEGRAM BOT COMMANDS & CALLBACKS ---

bot.start(async (ctx) => {
    const chatId = ctx.chat.id;
    const username = ctx.from.username || '';

    let authorized = await isAdminUser(chatId, username);
    if (authorized) {
        if (username) {
            await pool.query("UPDATE admins SET chat_id = $1 WHERE LOWER(username) = LOWER($2)", [chatId, username]);
        }
        return ctx.reply('👋 សួស្តី Admin! ប្រព័ន្ធគ្រប់គ្រងស្តុក OneDay Clothing ដំណើរការធម្មតា។');
    }

    userStates[chatId] = { action: 'WAITING_PASSWORD' };
    ctx.reply('🔐 សូមបញ្ចូល Password ដើម្បីចូលប្រើប្រាស់ប្រព័ន្ធ៖');
});

// 📊 មុខងារ /stats
bot.command('stats', async (ctx) => {
    const chatId = ctx.chat.id;
    const username = ctx.from.username || '';
    if (!await isAdminUser(chatId, username)) return ctx.reply('⛔️ គ្មានសិទ្ធិ!');

    try {
        let prodCount = await pool.query("SELECT COUNT(*) FROM products");
        let stockSum = await pool.query("SELECT SUM(stock_qty) FROM stock");
        let orderPending = await pool.query("SELECT COUNT(*) FROM orders WHERE status = 'PENDING'");
        let totalSales = await pool.query("SELECT SUM(total) FROM orders WHERE status = 'CONFIRMED'");

        let msg = `📊 **របាយការណ៍ និងស្ថិតិសរុប Oneday Clothing**\n\n`;
        msg += `📦 ផលិតផលសរុប: **${prodCount.rows[0].count} Ref**\n`;
        msg += `👕 គ្រឿងស្តុកសរុប: **${stockSum.rows[0].sum || 0} គ្រឿង**\n`;
        msg += `⏳ Order កំពុងរង់ចាំ (Pending): **${orderPending.rows[0].count}**\n`;
        msg += `💵 ជោគជ័យសរុប (Confirmed Sales): **$${parseFloat(totalSales.rows[0].sum || 0).toFixed(2)}**`;

        ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (err) {
        ctx.reply(`❌ មានបញ្ហា: ${err.message}`);
    }
});

// 📦 មុខងារ /orders
bot.command('orders', async (ctx) => {
    const chatId = ctx.chat.id;
    const username = ctx.from.username || '';
    if (!await isAdminUser(chatId, username)) return ctx.reply('⛔️ គ្មានសិទ្ធិ!');

    try {
        let res = await pool.query("SELECT * FROM orders WHERE status = 'PENDING' ORDER BY id DESC LIMIT 5");
        if (res.rows.length === 0) return ctx.reply('✅ គ្មាន Order ថ្មីកំពុងរង់ចាំ (Pending) ទេ!');

        for (let order of res.rows) {
            let cust = typeof order.customer === 'string' ? JSON.parse(order.customer) : order.customer;
            let items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;

            let msg = `📦 **Order ID: #${order.id}** (Status: PENDING)\n`;
            msg += `👤 ឈ្មោះ: ${cust?.name || 'អនាមិក'} (${cust?.phone || 'គ្មានលេខ'})\n`;
            msg += `📍 អាសយដ្ឋាន: ${cust?.address || 'គ្មាន'}\n`;
            msg += `🛒 ទំនិញ:\n`;
            for (let key in items) {
                let it = items[key];
                msg += `• Ref ${it.ref} (Size ${it.size}) x ${it.qty} = $${Number(it.price * it.qty).toFixed(2)}\n`;
            }
            msg += `💵 សរុប: $${Number(order.total).toFixed(2)}`;

            let inlineKeyboard = [
                [
                    { text: '✅ Confirm Order', callback_data: `confirm_order_${order.id}` },
                    { text: '❌ Cancel Order', callback_data: `cancel_order_${order.id}` }
                ]
            ];

            await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard } });
        }
    } catch (err) {
        ctx.reply(`❌ មានបញ្ហា: ${err.message}`);
    }
});

// 🔍 មុខងារ /search
bot.hears(/^\/search\s*(.+)/i, async (ctx) => {
    const chatId = ctx.chat.id;
    const username = ctx.from.username || '';
    if (!await isAdminUser(chatId, username)) return ctx.reply('⛔️ គ្មានសិទ្ធិ!');

    let rawRef = ctx.match[1].trim();
    let cleanRef = rawRef.replace(/ref:?\s*/i, '').trim().toUpperCase();

    try {
        let check = await pool.query("SELECT * FROM products WHERE UPPER(ref) = $1", [cleanRef]);
        if (check.rows.length === 0) return ctx.reply(`❌ រកមិនឃើញទំនិញ Ref ${cleanRef} ឡើយ!`);
        let prod = check.rows[0];

        let stockRes = await pool.query("SELECT size, stock_qty FROM stock WHERE UPPER(ref) = $1 ORDER BY size", [cleanRef]);
        let stockText = stockRes.rows.map(s => `${s.size}: ${s.stock_qty}`).join(' | ');

        let msg = `🔍 **ព័ត៌មានទំនិញ Ref : ${cleanRef}**\n\n`;
        msg += `• ឈ្មោះ: ${prod.title_km}\n`;
        msg += `• តម្លៃ: $${prod.price}\n`;
        msg += `• ភេទ: ${prod.gender}\n`;
        msg += `• ប្រភេទ: ${prod.type}\n`;
        msg += `• ស្តុក: [ ${stockText} ]\n`;
        if (prod.desc_km) msg += `• ការបរិយាយ: ${prod.desc_km}\n`;

        ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (err) {
        ctx.reply(`❌ មានបញ្ហា: ${err.message}`);
    }
});

// 🚚 ពាក្យបញ្ជា /delivery
bot.command(['delivery', 'Delivery'], async (ctx) => {
    const chatId = ctx.chat.id;
    const username = ctx.from.username || '';
    if (!await isAdminUser(chatId, username)) return ctx.reply('⛔️ គ្មានសិទ្ធិ!');

    userStates[chatId] = { action: 'WEBSITE', step: 'WAITING_DELIVERY_FEE' };
    
    await ctx.reply('🚚 **កំណត់ថ្លៃដឹកជញ្ជូន (Delivery Fee)**\n\nសូមផ្ញើសារតម្លៃថ្មី (ឧ. `2.00`) ឬវាយពាក្យថា **តម្លៃដឹកទូទាត់ជាមួយហាង**៖', {
        parse_mode: 'Markdown'
    });
});

// 🌐 ពាក្យបញ្ជា /website
bot.command(['website', 'Website'], async (ctx) => {
    const chatId = ctx.chat.id;
    const username = ctx.from.username || '';

    if (!await isAdminUser(chatId, username)) return ctx.reply('⛔️ គ្មានសិទ្ធិ!');

    userStates[chatId] = { action: 'WEBSITE' };

    await ctx.reply('🌐 **កំណត់រចនាប័ទ្ម Website (Website Settings)**\n\nសូមជ្រើសរើសផ្នែកដែលបងចង់ធ្វើការ៖', {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '👁️ មើលការកំណត់បច្ចុប្បន្ន', callback_data: 'web_view_settings' }],
                [{ text: '🎬 🖼️ កែប្រែ Cover (Video / Image)', callback_data: 'web_edit_cover' }],
                [{ text: '🎨 កែប្រែ Logo ហាង & Cart Icon', callback_data: 'web_edit_icon' }],
                [{ text: '📢 កែប្រែសារ Banner (Main Title)', callback_data: 'web_edit_title' }],
                [{ text: '🚚 កែប្រែថ្លៃដឹក (Delivery Fee)', callback_data: 'web_edit_delivery' }],
                [{ text: '❌ បោះបង់ (Cancel)', callback_data: 'web_cancel' }]
            ]
        }
    });
});

bot.action('web_view_settings', async (ctx) => {
    const chatId = ctx.chat.id;
    await ctx.answerCbQuery();

    try {
        let res = await pool.query("SELECT * FROM website_settings");
        let settings = {};
        res.rows.forEach(r => settings[r.key] = r.value);

        let coverUrl = settings.cover_url || 'Default System Media';
        let logoUrl = settings.logo_url || 'Default Logo Text (Oneday.)';
        let cartIconUrl = settings.cart_icon_url || 'Default Cart Icon';
        let mainTitle = settings.cover_title || 'BUILD YOUR DREAM STYLE';
        let deliveryFee = settings.delivery_fee || '2.00';

        let msg = `👁️ **ការកំណត់បច្ចុប្បន្នលើ Website:**\n\n`;
        msg += `📢 **Banner Title:** ${mainTitle}\n`;
        msg += `🚚 **Delivery Fee:** ${isNaN(deliveryFee) ? deliveryFee : '$' + parseFloat(deliveryFee).toFixed(2)}\n`;
        msg += `🎬/🖼️ **Cover Media:**\n${coverUrl}\n\n`;
        msg += `🖼️ **Shop Logo:**\n${logoUrl}\n\n`;
        msg += `🛒 **Cart Icon:**\n${cartIconUrl}`;

        await ctx.editMessageText(msg, {
            disable_web_page_preview: true,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 ត្រឡប់ក្រោយ', callback_data: 'web_back_menu' }]
                ]
            }
        });
    } catch (err) {
        await ctx.reply(`❌ មានបញ្ហា: ${err.message}`);
    }
});

bot.action('web_back_menu', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('🌐 **កំណត់រចនាប័ទ្ម Website (Website Settings)**\n\nសូមជ្រើសរើសផ្នែកដែលបងចង់ធ្វើការ៖', {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '👁️ មើលការកំណត់បច្ចុប្បន្ន', callback_data: 'web_view_settings' }],
                [{ text: '🎬 🖼️ កែប្រែ Cover (Video / Image)', callback_data: 'web_edit_cover' }],
                [{ text: '🎨 កែប្រែ Logo ហាង & Cart Icon', callback_data: 'web_edit_icon' }],
                [{ text: '📢 កែប្រែសារ Banner (Main Title)', callback_data: 'web_edit_title' }],
                [{ text: '🚚 កែប្រែថ្លៃដឹក (Delivery Fee)', callback_data: 'web_edit_delivery' }],
                [{ text: '❌ បោះបង់ (Cancel)', callback_data: 'web_cancel' }]
            ]
        }
    });
});

bot.action('web_edit_cover', async (ctx) => {
    const chatId = ctx.chat.id;
    userStates[chatId] = { action: 'WEBSITE', step: 'WAITING_COVER' };
    await ctx.answerCbQuery();
    await ctx.editMessageText('🎬/🖼️ **សូម Upload រូបភាព (Image) ឬ Video/GIF Animation** សម្រាប់ដាក់ធ្វើជា Cover Website ថ្មី៖');
});

bot.action('web_edit_icon', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('🎨 **ជ្រើសរើស Icon ឬ Logo ដែលចង់កែប្រែ៖**', {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🖼️ រូប Logo ហាង (Header Logo)', callback_data: 'web_set_icon_logo' }],
                [{ text: '🛒 រូប Cart Icon', callback_data: 'web_set_icon_cart' }]
            ]
        }
    });
});

bot.action(/^web_set_icon_(logo|cart)$/, async (ctx) => {
    let type = ctx.match[1];
    const chatId = ctx.chat.id;
    userStates[chatId] = { action: 'WEBSITE', step: `WAITING_ICON_${type.toUpperCase()}` };
    await ctx.answerCbQuery();
    await ctx.editMessageText(`🖼️ សូម Upload រូបភាព (Image/PNG) ថ្មីសម្រាប់ **${type.toUpperCase()}**:`);
});

bot.action('web_edit_title', async (ctx) => {
    const chatId = ctx.chat.id;
    userStates[chatId] = { action: 'WEBSITE', step: 'WAITING_TITLE' };
    await ctx.answerCbQuery();
    await ctx.editMessageText('📢 **សូមផ្ញើសារ/អក្សរ Banner ថ្មី** (ឧ. SPECIAL OFFER 20% OFF)៖');
});

bot.action('web_edit_delivery', async (ctx) => {
    const chatId = ctx.chat.id;
    userStates[chatId] = { action: 'WEBSITE', step: 'WAITING_DELIVERY_FEE' };
    await ctx.answerCbQuery();
    await ctx.editMessageText('🚚 **កំណត់ថ្លៃដឹកជញ្ជូន (Delivery Fee)**\n\nសូមផ្ញើសារតម្លៃថ្មី (ឧ. `2.00`) ឬវាយពាក្យថា **តម្លៃដឹកទូទាត់ជាមួយហាង**៖', { parse_mode: 'Markdown' });
});

bot.action('web_cancel', async (ctx) => {
    const chatId = ctx.chat.id;
    delete userStates[chatId];
    await ctx.answerCbQuery('❌ បានបោះបង់');
    await ctx.editMessageText('❌ បានលុបចោលដំណើរការកំណត់ Website រួចរាល់។');
});

bot.command('setmeowner', async (ctx) => {
    const chatId = ctx.chat.id;
    const username = ctx.from.username || '';

    try {
        let checkOwner = await pool.query("SELECT * FROM admins WHERE is_owner = TRUE");
        if (checkOwner.rows.length > 0) return ctx.reply('⛔️ ប្រព័ន្ធមាន Owner ផ្លូវការរួចរាល់ហើយ!');

        await pool.query(
            "INSERT INTO admins (chat_id, username, is_owner) VALUES ($1, $2, TRUE) ON CONFLICT (chat_id) DO UPDATE SET is_owner = TRUE, username = $2",
            [chatId, username]
        );
        ctx.reply('👑 ជោគជ័យ! Account របស់បងត្រូវបានកំណត់ជា Owner ផ្លូវការហើយ។');
    } catch (err) {
        ctx.reply(`❌ មានបញ្ហា: ${err.message}`);
    }
});

bot.command('checkadmin', async (ctx) => {
    const chatId = ctx.chat.id;
    const username = ctx.from.username || '';

    if (!await isOwnerUser(chatId, username)) return ctx.reply('⛔️ មានតែ Owner ទេដែលអាចប្រើប្រាស់មុខងារនេះបាន!');

    try {
        let ownerRes = await pool.query("SELECT username, chat_id FROM admins WHERE is_owner = TRUE");
        let adminsRes = await pool.query("SELECT username, chat_id FROM admins WHERE is_owner = FALSE OR is_owner IS NULL");

        let ownerText = ownerRes.rows.length > 0 ? (ownerRes.rows[0].username ? `@${ownerRes.rows[0].username}` : `ID: ${ownerRes.rows[0].chat_id}`) : 'មិនទាន់មាន';
        let msg = `👑 **Owner :** ${ownerText}\n\n📋 **បញ្ជី Admin ទាំងអស់:**\nសូមចុចលើឈ្មោះ Admin ខាងក្រោមដើម្បីផ្ទេរ Owner ឫ Kick:`;

        let inlineKeyboard = [];
        adminsRes.rows.forEach(adm => {
            let uName = adm.username ? `@${adm.username}` : `ID: ${adm.chat_id}`;
            let rawUName = adm.username || adm.chat_id.toString();
            inlineKeyboard.push([{ text: `👤 ${uName}`, callback_data: `manage_adm_${rawUName}` }]);
        });

        await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard } });
    } catch (err) {
        ctx.reply(`❌ មានបញ្ហា: ${err.message}`);
    }
});

bot.action(/^manage_adm_(.+)$/, async (ctx) => {
    const target = ctx.match[1];
    const chatId = ctx.chat.id;
    const username = ctx.from.username || '';

    if (!await isOwnerUser(chatId, username)) return ctx.answerCbQuery('⛔️ គ្មានសិទ្ធិ!', { show_alert: true });

    await ctx.answerCbQuery();
    await ctx.editMessageText(`⚙️ គ្រប់គ្រង Admin: **@${target}**\nតើអ្នកចង់ធ្វើអ្វីជាមួយ Account នេះ?`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '👑 ផ្ទេរ Owner', callback_data: `transfer_own_${target}` },
                    { text: '❌ Kick Admin', callback_data: `kick_adm_${target}` }
                ]
            ]
        }
    });
});

bot.action(/^transfer_own_(.+)$/, async (ctx) => {
    const target = ctx.match[1];
    const chatId = ctx.chat.id;
    const username = ctx.from.username || '';

    if (!await isOwnerUser(chatId, username)) return ctx.answerCbQuery('⛔️ គ្មានសិទ្ធិ!', { show_alert: true });

    try {
        await pool.query("UPDATE admins SET is_owner = FALSE WHERE chat_id = $1 OR LOWER(username) = LOWER($2)", [chatId, username]);
        await pool.query("UPDATE admins SET is_owner = TRUE WHERE LOWER(username) = LOWER($1) OR chat_id::text = $1", [target, target]);

        await ctx.answerCbQuery('✅ ផ្ទេរ Owner ជោគជ័យ!');
        await ctx.editMessageText(`👑 បានផ្ទេរអំណាចជា Owner ទៅឱ្យ **@${target}** រួចរាល់ហើយ!`, { parse_mode: 'Markdown' });
    } catch (err) {
        await ctx.answerCbQuery('❌ មានបញ្ហា', { show_alert: true });
    }
});

bot.action(/^kick_adm_(.+)$/, async (ctx) => {
    const target = ctx.match[1];
    const chatId = ctx.chat.id;
    const username = ctx.from.username || '';

    if (!await isOwnerUser(chatId, username)) return ctx.answerCbQuery('⛔️ គ្មានសិទ្ធិ!', { show_alert: true });

    try {
        let adminRec = await pool.query("SELECT chat_id, username, is_owner FROM admins WHERE LOWER(username) = LOWER($1) OR chat_id::text = $1", [target]);
        if (adminRec.rows.length > 0) {
            if (adminRec.rows[0].is_owner) return ctx.answerCbQuery('❌ មិនអាច Kick Owner បានទេ!', { show_alert: true });
            let adm = adminRec.rows[0];
            await pool.query("INSERT INTO banned_admins (chat_id, username) VALUES ($1, $2) ON CONFLICT (chat_id) DO UPDATE SET username = $2", [adm.chat_id, adm.username]);
            await pool.query("DELETE FROM admins WHERE LOWER(username) = LOWER($1) OR chat_id::text = $1", [target]);
        } else {
            await pool.query("INSERT INTO banned_admins (username) VALUES ($1) ON CONFLICT DO NOTHING", [target]);
        }

        await ctx.answerCbQuery('❌ Kick ជោគជ័យ!');
        await ctx.editMessageText(`❌ បាន Kick និង Block **@${target}** រួចរាល់!`, { parse_mode: 'Markdown' });
    } catch (err) {
        await ctx.answerCbQuery('❌ មានបញ្ហា', { show_alert: true });
    }
});

bot.hears(/^\/add\s*@?([a-zA-Z0-9_]+)/i, async (ctx) => {
    const chatId = ctx.chat.id;
    const username = ctx.from.username || '';

    if (!await isOwnerUser(chatId, username)) return ctx.reply('⛔️ មានតែ Owner ទេដែលអាចប្រើប្រាស់មុខងារបន្ថែម Admin បាន!');

    let targetUsername = ctx.match[1].trim();
    try {
        await pool.query("DELETE FROM banned_admins WHERE LOWER(username) = LOWER($1)", [targetUsername]);
        let tempChatId = -Math.floor(Date.now() + Math.random() * 1000);

        let existing = await pool.query("SELECT * FROM admins WHERE LOWER(username) = LOWER($1)", [targetUsername]);
        if (existing.rows.length > 0) {
            await pool.query("UPDATE admins SET is_owner = FALSE WHERE LOWER(username) = LOWER($1)", [targetUsername]);
        } else {
            await pool.query("INSERT INTO admins (chat_id, username, is_owner) VALUES ($1, $2, FALSE)", [tempChatId, targetUsername]);
        }

        ctx.reply(`✅ បានបន្ថែម ឬ Reactivation @${targetUsername} ជា Admin ជោគជ័យ!`);
    } catch (err) {
        ctx.reply(`❌ មានបញ្ហា: ${err.message}`);
    }
});

bot.hears(/^\/un\s*@?([a-zA-Z0-9_]+)/i, async (ctx) => {
    const chatId = ctx.chat.id;
    const username = ctx.from.username || '';

    if (!await isOwnerUser(chatId, username)) return ctx.reply('⛔️ មានតែ Owner ទេដែលអាចប្រើប្រាស់មុខងារដកសិទ្ធិ Admin បាន!');

    let targetUsername = ctx.match[1].trim();
    try {
        let targetCheck = await pool.query("SELECT * FROM admins WHERE LOWER(username) = LOWER($1)", [targetUsername]);
        if (targetCheck.rows.length > 0 && targetCheck.rows[0].is_owner) return ctx.reply('❌ មិនអាចលុបសិទ្ធិរបស់ Owner បានទេ!');

        if (targetCheck.rows.length > 0) {
            let adm = targetCheck.rows[0];
            await pool.query("INSERT INTO banned_admins (chat_id, username) VALUES ($1, $2) ON CONFLICT (chat_id) DO UPDATE SET username = $2", [adm.chat_id, adm.username]);
        } else {
            await pool.query("INSERT INTO banned_admins (username) VALUES ($1) ON CONFLICT DO NOTHING", [targetUsername]);
        }

        await pool.query("DELETE FROM admins WHERE LOWER(username) = LOWER($1)", [targetUsername]);
        ctx.reply(`❌ បានលុបសិទ្ធិ Admin របស់ @${targetUsername} រួចរាល់!`);
    } catch (err) {
        ctx.reply(`❌ មានបញ្ហា: ${err.message}`);
    }
});

bot.command('add', async (ctx) => {
    const chatId = ctx.chat.id;
    const username = ctx.from.username || '';
    if (!await isAdminUser(chatId, username)) return ctx.reply('⛔️ គ្មានសិទ្ធិ!');

    try {
        let prodRes = await pool.query("SELECT ref FROM products");
        let maxRef = 0;
        prodRes.rows.forEach(r => {
            let num = parseInt(r.ref);
            if (!isNaN(num) && num > maxRef) maxRef = num;
        });
        let nextRef = String(maxRef + 1);

        userStates[chatId] = { action: 'ADD', step: 'TITLE', data: { ref: nextRef } };
        ctx.reply(`📦 ចាប់ផ្តើមបន្ថែមទំនិញថ្មី (Ref : ${nextRef})\nសរសេរ : បញ្ចូលឈ្មោះទំនិញ`);
    } catch (err) {
        ctx.reply(`❌ មានបញ្ហា: ${err.message}`);
    }
});

const cancelHandler = async (ctx) => {
    const chatId = ctx.chat.id;
    if (userStates[chatId]) {
        delete userStates[chatId];
        ctx.reply('❌ បានលុបចោលដំណើរការរួចរាល់។');
    } else {
        ctx.reply('ℹ️ គ្មានដំណើរការណាកំពុងរត់ទេ។');
    }
};

bot.command('cancel', cancelHandler);
bot.command('cancle', cancelHandler);

bot.command('change', async (ctx) => {
    const chatId = ctx.chat.id;
    const username = ctx.from.username || '';
    if (!await isAdminUser(chatId, username)) return ctx.reply('⛔️ គ្មានសិទ្ធិ!');

    userStates[chatId] = { action: 'CHANGE', step: 'GET_REF' };
    ctx.reply('✏️ សូមសរសេរបញ្ចូលលេខ Ref របស់ទំនិញដែលចង់កែប្រែ:');
});

bot.hears(/^\/change(.+)/i, async (ctx) => {
    const chatId = ctx.chat.id;
    const username = ctx.from.username || '';
    if (!await isAdminUser(chatId, username)) return;

    let rawRef = ctx.match[1].trim();
    let cleanRef = rawRef.replace(/ref:?\s*/i, '').trim().toUpperCase();
    await handleEditRefSelection(ctx, chatId, cleanRef);
});

async function handleEditRefSelection(ctx, chatId, cleanRef) {
    try {
        let check = await pool.query("SELECT * FROM products WHERE UPPER(ref) = $1", [cleanRef]);
        if (check.rows.length === 0) return ctx.reply(`❌ រកមិនឃើញទំនិញ Ref ${cleanRef} ឡើយ!`);
        let prod = check.rows[0];

        userStates[chatId] = { action: 'CHANGE', step: 'SELECT_FIELD', data: { ref: cleanRef } };

        let msg = `⚙️ **កែប្រែទំនិញ Ref : ${cleanRef}**\n• ឈ្មោះ: ${prod.title_km}\n• តម្លៃលក់: $${prod.price}\n\nសូមជ្រើសរើសផ្នែកដែលចង់កែប្រែ៖`;

        await ctx.reply(msg, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📝 កែប្រែឈ្មោះ (Title)', callback_data: `edit_f_title_${cleanRef}` }],
                    [{ text: '💵 កែប្រែតម្លៃលក់ (Price)', callback_data: `edit_f_price_${cleanRef}` }],
                    [{ text: '📄 កែប្រែការបរិយាយ (Description)', callback_data: `edit_f_desc_${cleanRef}` }],
                    [{ text: '🎥/🖼️ កែប្រែ Media (Video/Image)', callback_data: `edit_f_video_${cleanRef}` }],
                    [{ text: '🚻 កែប្រែភេទ (Gender)', callback_data: `edit_f_gender_${cleanRef}` }],
                    [{ text: '❌ បោះបង់ (Cancel)', callback_data: 'edit_f_cancel' }]
                ]
            }
        });
    } catch (err) {
        ctx.reply(`❌ មានបញ្ហា: ${err.message}`);
    }
}

bot.action(/^edit_f_(title|price|desc|video|gender|cancel)_(.+)$/, async (ctx) => {
    let field = ctx.match[1];
    let ref = ctx.match[2];
    let chatId = ctx.chat.id;

    if (field === 'cancel') {
        delete userStates[chatId];
        await ctx.answerCbQuery('❌ បានបោះបង់');
        return ctx.editMessageText('❌ បានលុបចោលដំណើរការរួចរាល់។');
    }

    if (field === 'gender') {
        userStates[chatId] = { action: 'CHANGE', step: 'UPDATE_GENDER', data: { ref } };
        await ctx.answerCbQuery();
        await ctx.editMessageText(`🚻 កែប្រែ Ref ${ref} - ជ្រើសរើសប្រភេទភេទ:`, {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'Men (បុរស)', callback_data: `update_gender_men_${ref}` },
                        { text: 'Women (នារី)', callback_data: `update_gender_women_${ref}` }
                    ]
                ]
            }
        });
        return;
    }

    userStates[chatId] = { action: 'CHANGE', step: `UPDATE_${field.toUpperCase()}`, data: { ref } };
    await ctx.answerCbQuery();
    
    let promptText = '';
    if (field === 'title') promptText = `✏️ សូមសរសេរឈ្មោះទំនិញថ្មីសម្រាប់ Ref ${ref}:`;
    else if (field === 'price') promptText = `💵 សូមសរសេរតម្លៃលក់ថ្មីសម្រាប់ Ref ${ref} (ឧ. 15.00):`;
    else if (field === 'desc') promptText = `📄 សូមសរសេរការបរិយាយថ្មីសម្រាប់ Ref ${ref}:`;
    else if (field === 'video') promptText = `🎥/🖼️ សូម Upload Video ឬ រូបភាព (Image) ថ្មីសម្រាប់ Ref ${ref}:`;

    await ctx.editMessageText(promptText);
});

bot.action(/^update_gender_(men|women)_(.+)$/, async (ctx) => {
    let gender = ctx.match[1];
    let ref = ctx.match[2];
    let chatId = ctx.chat.id;

    try {
        await pool.query("UPDATE products SET gender = $1 WHERE UPPER(ref) = $2", [gender, ref]);
        delete userStates[chatId];
        await ctx.answerCbQuery('✅ បានកែប្រែភេទជោគជ័យ!');
        await ctx.editMessageText(`✅ ជោគជ័យ! ទំនិញ Ref ${ref} ត្រូវបានកែប្រែភេទរួចរាល់។`);
    } catch (err) {
        await ctx.answerCbQuery('❌ មានបញ្ហា', { show_alert: true });
    }
});

// 🗑️ Command /deleteref
bot.hears(/^\/deleteref(.+)/i, async (ctx) => {
    const chatId = ctx.chat.id;
    const username = ctx.from.username || '';
    if (!await isAdminUser(chatId, username)) return ctx.reply('⛔️ គ្មានសិទ្ធិ!');

    let rawRef = ctx.match[1].trim();
    let cleanRef = rawRef.replace(/ref:?\s*/i, '').trim().toUpperCase();

    try {
        let check = await pool.query("SELECT * FROM products WHERE UPPER(ref) = $1", [cleanRef]);
        if (check.rows.length === 0) return ctx.reply(`❌ រកមិនឃើញទំនិញ Ref ${cleanRef} ឡើយ!`);

        let product = check.rows[0];

        // លុបទិន្នន័យចេញពី DB
        let deletedNum = parseInt(cleanRef);
        await pool.query("DELETE FROM stock WHERE UPPER(ref) = $1", [cleanRef]);
        await pool.query("DELETE FROM purchases WHERE UPPER(ref) = $1", [cleanRef]);
        await pool.query("DELETE FROM products WHERE UPPER(ref) = $1", [cleanRef]);

        // 🛡️ ឆែកមើលថា File កំពុងប្រើប្រាស់កន្លែងផ្សេងទៀតឬអត់ មុនពេលលុបចេញពី Volume Disk
        if (product.video_url && product.video_url.includes('/videos/')) {
            try {
                let fileName = product.video_url.split('/videos/').pop().split('?')[0];
                let filePath = path.join(videoDir, fileName);

                let inUse = await isMediaInUse(fileName);
                if (!inUse && fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (e) {
                console.error("Error deleting file:", e);
            }
        }

        // រំកិលលេខ Ref ឡើងលើ
        if (!isNaN(deletedNum)) {
            let allProds = await pool.query("SELECT ref FROM products ORDER BY CAST(ref AS INTEGER) ASC");
            for (let row of allProds.rows) {
                let currentNum = parseInt(row.ref);
                if (!isNaN(currentNum) && currentNum > deletedNum) {
                    let newNum = currentNum - 1;
                    await pool.query("UPDATE products SET ref = $1 WHERE ref = $2", [String(newNum), row.ref]);
                    await pool.query("UPDATE stock SET ref = $1 WHERE ref = $2", [String(newNum), row.ref]);
                    await pool.query("UPDATE purchases SET ref = $1 WHERE ref = $2", [String(newNum), row.ref]);
                }
            }
        }

        ctx.reply(`🗑️ លុប Ref ${cleanRef} និងរំកិលលេខកូដទំនិញជោគជ័យ!`);
    } catch (err) {
        ctx.reply(`❌ មានបញ្ហា: ${err.message}`);
    }
});

// 🧹 Command /cleanup
bot.command('cleanup', async (ctx) => {
    const chatId = ctx.chat.id;
    const username = ctx.from.username || '';
    if (!await isAdminUser(chatId, username)) return ctx.reply('⛔️ គ្មានសិទ្ធិ!');

    try {
        if (!fs.existsSync(videoDir)) return ctx.reply('⚠️ គ្មាន Folder វីដេអូទេ!');
        let files = fs.readdirSync(videoDir);

        let deletedCount = 0;
        for (let file of files) {
            let inUse = await isMediaInUse(file);
            if (!inUse) {
                try {
                    fs.unlinkSync(path.join(videoDir, file));
                    deletedCount++;
                } catch (e) {}
            }
        }

        ctx.reply(`🧹 សម្អាត Media ចាស់ៗដែលមិនបានប្រើប្រាស់បានចំនួន ${deletedCount} ហ្វាល! (File ដែលកំពុងបង្ហាញលើ Web ត្រូវបានរក្សាទុក)`);
    } catch (err) {
        ctx.reply(`❌ មានបញ្ហា: ${err.message}`);
    }
});

bot.action(/^confirm_order_(.+)$/, async (ctx) => {
    let orderId = ctx.match[1];
    try {
        await pool.query("UPDATE orders SET status = 'CONFIRMED' WHERE id = $1", [orderId]);
        await ctx.answerCbQuery('✅ បានបញ្ជាក់ការកុម្មង់!');
        let originalText = ctx.callbackQuery.message.text;
        await ctx.editMessageText(originalText + '\n\nstatus: ✅ Confirmed', { reply_markup: { inline_keyboard: [] } });
    } catch (err) {
        await ctx.answerCbQuery('❌ មានបញ្ហា', { show_alert: true });
    }
});

bot.action(/^cancel_order_(.+)$/, async (ctx) => {
    let orderId = ctx.match[1];
    try {
        let orderRes = await pool.query("SELECT * FROM orders WHERE id = $1", [orderId]);
        if (orderRes.rows.length === 0) return ctx.answerCbQuery('❌ រកមិនឃើញ!');
        let order = orderRes.rows[0];
        if (order.status === 'CANCELLED') return ctx.answerCbQuery('⚠️ លុបចោលរួចហើយ!');

        let items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
        for (let key in items) {
            let item = items[key];
            await pool.query(
                "UPDATE stock SET stock_qty = stock_qty + $1 WHERE UPPER(ref) = $2 AND UPPER(size) = $3",
                [parseInt(item.qty) || 0, String(item.ref).toUpperCase(), String(item.size).toUpperCase()]
            );
        }

        await pool.query("UPDATE orders SET status = 'CANCELLED' WHERE id = $1", [orderId]);
        await ctx.answerCbQuery('❌ បានបដិសេធ និងសងស្តុកចូលវិញ!');
        let originalText = ctx.callbackQuery.message.text;
        await ctx.editMessageText(originalText + '\n\nstatus: ❌ Cancelled & Stock Restored', { reply_markup: { inline_keyboard: [] } });
    } catch (err) {
        await ctx.answerCbQuery('❌ មានបញ្ហា', { show_alert: true });
    }
});

bot.action(/^gender_(.+)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    if (!userStates[chatId] || userStates[chatId].step !== 'GENDER') return;

    let gender = ctx.match[1];
    userStates[chatId].data.gender = gender;
    userStates[chatId].step = 'TYPE';

    await ctx.answerCbQuery();
    await ctx.editMessageText(`🚻 ភេទ: ${gender === 'men' ? 'Men' : 'Women'}`);
    await ctx.reply('សូមបញ្ជាក់ប្រភេទ:', {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Tops (អាវ)', callback_data: 'type_tops' },
                    { text: 'Pants (ខោ)', callback_data: 'type_pants' }
                ],
                [
                    { text: 'Outerwear', callback_data: 'type_outerwear' },
                    { text: 'Dresses', callback_data: 'type_dresses' }
                ]
            ]
        }
    });
});

bot.action(/^type_(.+)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    if (!userStates[chatId] || userStates[chatId].step !== 'TYPE') return;

    let type = ctx.match[1];
    userStates[chatId].data.type = type;
    let state = userStates[chatId];

    await ctx.answerCbQuery();
    await ctx.editMessageText(`🏷️ ប្រភេទ: ${type}`);

    try {
        let cleanRef = String(state.data.ref).trim().toUpperCase();
        let parsedPrice = parseFloat(state.data.price) || 0;
        let parsedCost = 0;
        let tTitle = await autoTranslate(state.data.title_km);
        let tDesc = await autoTranslate(state.data.desc_km || '');

        await pool.query(
            `INSERT INTO products (ref, title_km, title_en, title_zh, desc_km, desc_en, desc_zh, gender, type, video_url, price, cost_price) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
             ON CONFLICT (ref) DO UPDATE 
             SET title_km = $2, title_en = $3, title_zh = $4, desc_km = $5, desc_en = $6, desc_zh = $7, gender = $8, type = $9, video_url = $10, price = $11, cost_price = $12`,
            [cleanRef, state.data.title_km, tTitle.en, tTitle.zh, state.data.desc_km || '', tDesc.en, tDesc.zh, state.data.gender || 'men', state.data.type || 'tops', state.data.video_url || '', parsedPrice, parsedCost]
        );

        if (state.action === 'ADD') {
            let sizes = ['S', 'M', 'L', 'XL', 'XXL'];
            for (let size of sizes) {
                await pool.query(
                    `INSERT INTO stock (ref, size, stock_qty, price) VALUES ($1, $2, $3, $4) ON CONFLICT (ref, size) DO UPDATE SET price = $4`,
                    [cleanRef, size, 0, parsedPrice]
                );
            }
        }

        await ctx.reply('បន្ថែមទំនិញថ្មីជោគជ័យ! 📦');
    } catch (err) {
        await ctx.reply(`❌ មានបញ្ហា: ${err.message}`);
    }

    delete userStates[chatId];
});

bot.on('message', async (ctx) => {
    const chatId = ctx.chat.id;
    const msg = ctx.message;
    const text = msg.text || msg.caption || '';
    const username = ctx.from.username || '';

    if (userStates[chatId] && userStates[chatId].action === 'WAITING_PASSWORD') {
        let banCheck = await pool.query(
            "SELECT * FROM banned_admins WHERE chat_id = $1 OR (username != '' AND LOWER(username) = LOWER($2))",
            [chatId, username]
        );
        if (banCheck.rows.length > 0) {
            delete userStates[chatId];
            return ctx.reply('⛔️ អ្នកត្រូវបានគេដកសិទ្ធិ (Ban) ពីប្រព័ន្ធហើយ!');
        }

        if (text.trim() === 'onedaybyday') {
            let checkAdmins = await pool.query("SELECT COUNT(*) FROM admins");
            let isFirst = parseInt(checkAdmins.rows[0].count) === 0;

            await pool.query(
                "INSERT INTO admins (chat_id, username, is_owner) VALUES ($1, $2, $3) ON CONFLICT (chat_id) DO UPDATE SET username = $2",
                [chatId, username, isFirst]
            );
            delete userStates[chatId];
            return ctx.reply(isFirst ? '👑 Password ត្រឹមត្រូវ! អ្នកជា Owner ផ្លូវការ!' : '✅ Password ត្រឹមត្រូវ! សូមផ្ញើ /start សារថ្មី។');
        } else {
            return ctx.reply('❌ Password មិនត្រឹមត្រូវទេ!');
        }
    }

    let authorized = await isAdminUser(chatId, username);
    if (!authorized) return ctx.reply('⛔️ គ្មានសិទ្ធិ! សូមផ្ញើ /start ដើម្បីវាយបញ្ចូល Password។');

    if (!userStates[chatId]) return;
    let state = userStates[chatId];

    await ctx.sendChatAction('typing');

    // 🎬/🖼️ ដំណើរការកំណត់ Website (/website និង /delivery)
    if (state.action === 'WEBSITE') {
        if (state.step === 'WAITING_TITLE') {
            if (!text.trim()) return ctx.reply('⚠️ សូមផ្ញើសារ/អក្សរឱ្យបានត្រឹមត្រូវ!');
            await pool.query(
                "INSERT INTO website_settings (key, value) VALUES ('cover_title', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
                [text.trim()]
            );
            delete userStates[chatId];
            return ctx.reply(`✅ **ជោគជ័យ!** Banner Title ថ្មីត្រូវបានអាប់ដេត៖\n"${text.trim()}"`, { parse_mode: 'Markdown' });
        }

        if (state.step === 'WAITING_DELIVERY_FEE') {
            let inputVal = text.trim();
            if (!inputVal) return ctx.reply('⚠️ សូមបញ្ចូលតម្លៃ ឬអត្ថបទឱ្យបានត្រឹមត្រូវ!');
            
            await pool.query(
                "INSERT INTO website_settings (key, value) VALUES ('delivery_fee', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
                [inputVal]
            );
            delete userStates[chatId];
            return ctx.reply(`✅ **ជោគជ័យ!** ថ្លៃដឹក (Delivery Fee) ត្រូវបានកំណត់ជា៖ **${inputVal}**`, { parse_mode: 'Markdown' });
        }

        let uploadedUrl = '';
        let fileObj = getTelegramMediaObject(msg);

        if (fileObj) {
            if (fileObj.file_size && fileObj.file_size > 20 * 1024 * 1024) {
                return ctx.reply('⚠️ ហ្វាលនេះមានទំហំធំជាង 20MB! Telegram Bot អនុញ្ញាតឱ្យទាញយកត្រឹម 20MB ប៉ុណ្ណោះ។ សូមពង្រួមហ្វាល ឬផ្ញើជា Link (http...) ជំនួសវិញ។');
            }
            try {
                uploadedUrl = await downloadAndSaveTelegramFile(ctx, fileObj.file_id, 'web');
            } catch (err) {
                return ctx.reply(`❌ Upload បរាជ័យ: ${err.message}`);
            }
        } else if (text.trim().startsWith('http')) {
            uploadedUrl = text.trim();
        } else {
            return ctx.reply('⚠️ សូម Upload វីដេអូ រូបភាព ឬផ្ញើ Link លីងឱ្យបានត្រឹមត្រូវ!');
        }

        if (state.step === 'WAITING_COVER') {
            await pool.query(
                "INSERT INTO website_settings (key, value) VALUES ('cover_url', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
                [uploadedUrl]
            );
            delete userStates[chatId];
            return ctx.reply(`✅ **ជោគជ័យ!** Cover Website ថ្មីត្រូវបានអាប់ដេតរួចរាល់៖\n${uploadedUrl}`, { parse_mode: 'Markdown' });
        }

        if (state.step === 'WAITING_ICON_LOGO') {
            await pool.query(
                "INSERT INTO website_settings (key, value) VALUES ('logo_url', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
                [uploadedUrl]
            );
            delete userStates[chatId];
            return ctx.reply(`✅ **ជោគជ័យ!** Logo Website ថ្មីត្រូវបានអាប់ដេតរួចរាល់！`);
        }

        if (state.step === 'WAITING_ICON_CART') {
            await pool.query(
                "INSERT INTO website_settings (key, value) VALUES ('cart_icon_url', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
                [uploadedUrl]
            );
            delete userStates[chatId];
            return ctx.reply(`✅ **ជោគជ័យ!** Cart Icon ថ្មីត្រូវបានអាប់ដេតរួចរាល់！`);
        }
    }

    // ✏️ ដំណើរការ កែប្រែទំនិញ (/change)
    if (state.action === 'CHANGE') {
        if (state.step === 'GET_REF') {
            let cleanRef = text.replace(/ref:?\s*/i, '').trim().toUpperCase();
            if (!cleanRef) return ctx.reply('⚠️ សូមបញ្ចូលលេខ Ref!');
            delete userStates[chatId];
            return handleEditRefSelection(ctx, chatId, cleanRef);
        }

        let ref = state.data.ref;
        if (state.step === 'UPDATE_TITLE') {
            if (!text.trim()) return ctx.reply('⚠️ សូមបញ្ចូលឈ្មោះ!');
            let tTitle = await autoTranslate(text.trim());
            await pool.query("UPDATE products SET title_km = $1, title_en = $2, title_zh = $3 WHERE UPPER(ref) = $4", [text.trim(), tTitle.en, tTitle.zh, ref]);
            delete userStates[chatId];
            return ctx.reply(`✅ កែប្រែឈ្មោះ Ref ${ref} ជោគជ័យ!`);
        }
        if (state.step === 'UPDATE_PRICE') {
            let newPrice = parseFloat(text);
            if (isNaN(newPrice)) return ctx.reply('⚠️ សូមបញ្ចូលតម្លៃលក់ជាតួលេខ!');
            await pool.query("UPDATE products SET price = $1 WHERE UPPER(ref) = $2", [newPrice, ref]);
            await pool.query("UPDATE stock SET price = $1 WHERE UPPER(ref) = $2", [newPrice, ref]);
            delete userStates[chatId];
            return ctx.reply(`✅ កែប្រែតម្លៃលក់ Ref ${ref} ជោគជ័យ!`);
        }
        if (state.step === 'UPDATE_DESC') {
            let tDesc = await autoTranslate(text.trim());
            await pool.query("UPDATE products SET desc_km = $1, desc_en = $2, desc_zh = $3 WHERE UPPER(ref) = $4", [text.trim(), tDesc.en, tDesc.zh, ref]);
            delete userStates[chatId];
            return ctx.reply(`✅ កែប្រែការបរិយាយ Ref ${ref} ជោគជ័យ!`);
        }
        if (state.step === 'UPDATE_VIDEO') {
            let videoUrl = '';
            let fileObj = getTelegramMediaObject(msg);

            if (fileObj) {
                if (fileObj.file_size && fileObj.file_size > 20 * 1024 * 1024) {
                    return ctx.reply('⚠️ ហ្វាលនេះមានទំហំធំជាង 20MB! Telegram Bot អនុញ្ញាតត្រឹម 20MB ប៉ុណ្ណោះ។');
                }
                try {
                    videoUrl = await downloadAndSaveTelegramFile(ctx, fileObj.file_id, 'media');
                } catch (err) {
                    return ctx.reply(`❌ បរាជ័យ: ${err.message}`);
                }
            } else if (text.trim()) {
                videoUrl = text.trim().startsWith('http') ? text.trim() : `${RAILWAY_HOST}/${text.trim()}`;
            } else {
                return ctx.reply('⚠️ សូម Upload Video ឬ រូបភាព (Image) ឱ្យបានត្រឹមត្រូវ!');
            }

            // 🛡️ លុប Media ចាស់ ប្រសិនបើវាគ្មានប្រយោជន៍លើ Web ទៀត
            try {
                let oldProd = await pool.query("SELECT video_url FROM products WHERE UPPER(ref) = $1", [ref]);
                if (oldProd.rows.length > 0 && oldProd.rows[0].video_url && oldProd.rows[0].video_url.includes('/videos/')) {
                    let oldFileName = oldProd.rows[0].video_url.split('/videos/').pop().split('?')[0];
                    await pool.query("UPDATE products SET video_url = $1 WHERE UPPER(ref) = $2", [videoUrl, ref]);
                    let inUse = await isMediaInUse(oldFileName);
                    if (!inUse) {
                        let oldFilePath = path.join(videoDir, oldFileName);
                        if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);
                    }
                } else {
                    await pool.query("UPDATE products SET video_url = $1 WHERE UPPER(ref) = $2", [videoUrl, ref]);
                }
            } catch (e) {
                await pool.query("UPDATE products SET video_url = $1 WHERE UPPER(ref) = $2", [videoUrl, ref]);
            }

            delete userStates[chatId];
            return ctx.reply(`✅ កែប្រែ Media សម្រាប់ Ref ${ref} ជោគជ័យ!`);
        }
        return;
    }

    // 📦 ដំណើរការ បន្ថែមទំនិញថ្មី (/add)
    switch (state.step) {
        case 'TITLE':
            if (!text.trim()) return ctx.reply('⚠️ បញ្ចូលឈ្មោះទំនិញ');
            state.data.title_km = text.trim();
            state.data.cost_price = 0;
            state.step = 'PRICE';
            return ctx.reply('💵 សូមសរសេរបញ្ចូលតម្លៃលក់ (ឧទាហរណ៍: 15.00):');
        case 'PRICE':
            let parsedPrice = parseFloat(text.trim());
            if (isNaN(parsedPrice) || parsedPrice <= 0) {
                return ctx.reply('⚠️ សូមបញ្ចូលតម្លៃលក់ជាតួលេខឱ្យបានត្រឹមត្រូវ (ឧ. 15 ឬ 15.50)!');
            }
            state.data.price = parsedPrice;
            state.step = 'DESC';
            return ctx.reply('សូមសរសេរការបរិយាយពីទំនិញ:');
        case 'DESC':
            state.data.desc_km = text.trim();
            state.step = 'VIDEO';
            return ctx.reply('សូម Upload វីដេអូ ឬ រូបភាព (Image/Video/GIF/Link):');
        case 'VIDEO':
            let videoUrl = '';
            let fileObj = getTelegramMediaObject(msg);

            if (fileObj) {
                if (fileObj.file_size && fileObj.file_size > 20 * 1024 * 1024) {
                    return ctx.reply('⚠️ ហ្វាលនេះមានទំហំធំជាង 20MB! Telegram Bot អនុញ្ញាតត្រឹម 20MB ប៉ុណ្ណោះ។');
                }
                try {
                    videoUrl = await downloadAndSaveTelegramFile(ctx, fileObj.file_id, 'media');
                } catch (err) {
                    return ctx.reply(`❌ បរាជ័យ: ${err.message}`);
                }
            } else if (text.trim()) {
                videoUrl = text.trim().startsWith('http') ? text.trim() : `${RAILWAY_HOST}/${text.trim()}`;
            } else {
                return ctx.reply('⚠️ សូម Upload Video ឬ រូបភាព (Image) ឱ្យបានត្រឹមត្រូវ!');
            }

            state.data.video_url = videoUrl;
            state.step = 'GENDER';
            return ctx.reply('ជ្រើសរើសប្រភេទភេទ:', {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: 'Men (បុរស)', callback_data: 'gender_men' },
                            { text: 'Women (នារី)', callback_data: 'gender_women' }
                        ]
                    ]
                }
            });
    }
});

// 📌 កំណត់ បញ្ជីពាក្យបញ្ជា (Command Menu) ស្វ័យប្រវត្តិ
bot.telegram.setMyCommands([
    { command: 'start', description: 'ចាប់ផ្តើមប្រព័ន្ធ / ផ្ទៀងផ្ទាត់ Password' },
    { command: 'stats', description: 'មើលរបាយការណ៍ និងស្ថិតិសរុប' },
    { command: 'orders', description: 'មើលបញ្ជីកុម្មង់កំពុងរង់ចាំ (Pending Orders)' },
    { command: 'search', description: 'ស្វែងរកទំនិញតាម Ref (ឧ. /search 1)' },
    { command: 'website', description: 'កែប្រែ Cover (Image/Video), Logo & Banner' },
    { command: 'delivery', description: 'កែប្រែថ្លៃដឹក (Delivery Fee ឬ ទូទាត់ជាមួយហាង)' },
    { command: 'checkadmin', description: 'មើលបញ្ជី Owner និង Admin (សម្រាប់ Owner)' },
    { command: 'add', description: 'បន្ថែមទំនិញថ្មីចូលស្តុក (Image/Video)' },
    { command: 'change', description: 'កែប្រែព័ត៌មានទំនិញ' },
    { command: 'cleanup', description: 'សម្អាត Media ចាស់ៗដែលមិនបានប្រើប្រាស់' },
    { command: 'cancel', description: 'បោះបង់សកម្មភាពកំពុងរត់' },
    { command: 'setmeowner', description: 'កំណត់សិទ្ធិ Owner (ប្រើពេលដំបូង)' }
]).catch(err => console.error("Set commands error:", err));

bot.launch();
console.log('Telegram Bot started successfully...');

// 🛑 ផ្តាច់ Bot Connection ស្អាតបាតពេល Server Restart / Stop ដើម្បីការពារបញ្ហា 409 Conflict
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
