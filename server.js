const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // Serve វេបសាយ និង admin.html ផ្ទាល់

// ភ្ជាប់ Database ស្វ័យប្រវត្តិពី Railway
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Telegram Bot Setup ជាមួយ Token របស់អ្នក
const BOT_TOKEN = '8940415740:AAH0f6Ng3dMz0hpgi9_fIY_T-b6a30-AF58';
const bot = new Telegraf(BOT_TOKEN);

// កន្លែងរក្សាទុកដំណាក់កាលបំពេញទិន្នន័យតាម Chat របស់ Admin ម្នាក់ៗ
let userStates = {};

// មុខងារកត់ត្រា Admin Chat ID ស្វ័យប្រវត្តិ
async function registerAdmin(chatId) {
    try {
        await pool.query("INSERT INTO admins (chat_id) VALUES ($1) ON CONFLICT (chat_id) DO NOTHING", [chatId]);
    } catch (err) {
        console.error("Error registering admin:", err);
    }
}

// បង្កើត Folder videos បើមិនទាន់មាន
const videoDir = path.join(__dirname, 'videos');
if (!fs.existsSync(videoDir)) {
    fs.mkdirSync(videoDir, { recursive: true });
}

// បង្កើត Table ស្តុក ផលិតផល អដ្មេន និង ការកុម្មង់ ស្វ័យប្រវត្តិពេលចាប់ផ្តើម Server
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS products (
                ref VARCHAR(50) PRIMARY KEY,
                title_km VARCHAR(255),
                desc_km TEXT,
                gender VARCHAR(20),
                type VARCHAR(20),
                video_url VARCHAR(255),
                price DECIMAL(10,2)
            );
        `);

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
            CREATE TABLE IF NOT EXISTS admins (
                chat_id BIGINT PRIMARY KEY
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
                ['1', 'T-Shirt Polo Collab OneDay', 'អាវយឺត Polo រចនាម៉ូដទាន់សម័យ ងាយពាក់', 'men', 'tops', 'videos/Man_walking_in_fashion_studio_202608272139.mp4', 15.00],
                ['2', 'Olive Green Mandarin Collar Long-Sleeve Shirt', 'អាវដៃវែងកាតគៀនពណ៌បៃតងអូលីវ ស្អាតប្រណិត', 'men', 'tops', 'videos/Model_walking_in_fashion_studio_202608272237.mp4', 6.00],
                ['3', 'Outfit Smart Casual (Full Set)', 'ឈុតសម្លៀកបំពាក់ Smart Casual ទាន់សម័យ', 'men', 'tops', 'videos/Male_model_walking_in_studio_202608271814.mp4', 20.00],
                ['4', 'Plaid Sailor Collar Blouse', 'អាវនារី ករសាឡាប្រណិត ស្អាតទាន់សម័យ', 'women', 'tops', 'videos/Woman_modeling_shirt_360_rotation_202609061421.mp4', 7.00],
                ['5', 'Striped Crew Neck T-Shirt', 'អាវយឺតដៃខ្លី Casual សាមញ្ញ មានករបើកមូល និងមានម៉ូដឆ្នូតទទឹងពណ៌ត្នោតស្រាលលាយស', 'men', 'tops', 'videos/Fashion_commercial_video_production_20260911003050.mp4', 12.00],
                ['6', 'Vertical Striped Button-Up Shirt', 'អាវដៃវែងក្រឡាមូដឆ្នូតត្រង់ សម្រាប់ធ្វើការ ទៅរៀន', 'men', 'tops', 'videos/Fashion_model_commercial_video_20260911003817.mp4', 18.00]
            ];
            for (let prod of initialProducts) {
                await pool.query(
                    "INSERT INTO products (ref, title_km, desc_km, gender, type, video_url, price) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (ref) DO NOTHING",
                    prod
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
        let defaultQty = initial_stock !== undefined ? parseInt(initial_stock) : 0;

        await pool.query(
            `INSERT INTO products (ref, title_km, desc_km, gender, type, video_url, price) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             ON CONFLICT (ref) DO UPDATE 
             SET title_km = $2, desc_km = $3, gender = $4, type = $5, video_url = $6, price = $7`,
            [cleanRef, title_km, desc_km || '', gender || 'men', type || 'tops', video_url || '', parsedPrice]
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

        res.json({ success: true, message: `ទំនិញ Ref ${cleanRef} ត្រូវបានបន្ថែម និងបង្កើតស្តុកជោគជ័យ!` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/order', async (req, res) => {
    let { customer, items } = req.body;
    try {
        let totalAmount = 0;
        let itemsSummary = [];

        for (let key in items) {
            let item = items[key];
            let cleanRef = item.ref.replace(/ref:?\s*/i, '').trim().toUpperCase();
            let cleanSize = item.size.trim().toUpperCase();
            let qty = parseInt(item.qty) || 1;
            
            let check = await pool.query(
                "SELECT s.stock_qty, p.title_km, p.price FROM stock s JOIN products p ON s.ref = p.ref WHERE UPPER(s.ref) = $1 AND UPPER(s.size) = $2",
                [cleanRef, cleanSize]
            );
            
            if (check.rows.length > 0) {
                let currentStock = check.rows[0].stock_qty;
                if (currentStock < qty) {
                    return res.json({ 
                        success: false, 
                        message: `សូមអភ័យទោស! ទំនិញ Ref ${cleanRef} Size ${cleanSize} ស្តុកមិនគ្រប់គ្រាន់ទេ!` 
                    });
                }
                let itemTotal = parseFloat(check.rows[0].price) * qty;
                totalAmount += itemTotal;
                itemsSummary.push({
                    ref: cleanRef,
                    title: check.rows[0].title_km,
                    size: cleanSize,
                    qty: qty,
                    price: check.rows[0].price,
                    total: itemTotal
                });
            } else {
                return res.json({ success: false, message: `រកមិនឃើញទំនិញ Ref ${cleanRef} Size ${cleanSize} ឡើយ!` });
            }
        }

        let orderRes = await pool.query(
            "INSERT INTO orders (customer, items, total, status) VALUES ($1, $2, $3, 'PENDING') RETURNING id",
            [JSON.stringify(customer || {}), JSON.stringify(itemsSummary), totalAmount]
        );
        let orderId = orderRes.rows[0].id;

        for (let key in items) {
            let item = items[key];
            let cleanRef = item.ref.replace(/ref:?\s*/i, '').trim().toUpperCase();
            let cleanSize = item.size.trim().toUpperCase();
            let qty = parseInt(item.qty) || 1;
            
            await pool.query(
                "UPDATE stock SET stock_qty = stock_qty - $1 WHERE UPPER(ref) = $2 AND UPPER(size) = $3",
                [qty, cleanRef, cleanSize]
            );
        }

        let adminsRes = await pool.query("SELECT chat_id FROM admins");
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
                } catch (e) {
                    console.error("Failed to notify admin:", adm.chat_id, e.message);
                }
            }
        }

        res.json({ success: true, message: "ការកុម្មង់បានជោគជ័យ និងកាត់ស្តុកស្វ័យប្រវត្តិរួចរាល់!" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- TELEGRAM BOT COMMANDS & CALLBACKS ---

bot.start(async (ctx) => {
    await registerAdmin(ctx.chat.id);
    ctx.reply('👋 សួស្តី Admin! ប្រព័ន្ធគ្រប់គ្រងស្តុក OneDay Clothing ដំណើរការធម្មតា។');
});

// 1. ពាក្យបញ្ជា /add (សម្រាប់បន្ថែមទំនិញ)
bot.command('add', async (ctx) => {
    const chatId = ctx.chat.id;
    await registerAdmin(chatId);
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
        ctx.reply(`❌ មានបញ្ហាក្នុងការបង្កើត Ref ស្វ័យប្រវត្តិ: ${err.message}`);
    }
});

// 2. ពាក្យបញ្ជា /cancel ឬ /cancle (សម្រាប់បោះបង់ដំណើរការ)
const cancelHandler = (ctx) => {
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

// 3. ពាក្យបញ្ជា /change (សម្រាប់កែប្រែទំនិញតាម Ref)
bot.command('change', async (ctx) => {
    let chatId = ctx.chat.id;
    await registerAdmin(chatId);
    userStates[chatId] = { action: 'CHANGE', step: 'GET_REF' };
    ctx.reply('✏️ សូមសរសេរបញ្ចូលលេខ Ref របស់ទំនិញដែលចង់កែប្រែ:');
});

bot.hears(/^\/change(.+)/i, async (ctx) => {
    let chatId = ctx.chat.id;
    await registerAdmin(chatId);
    let rawRef = ctx.match[1].trim();
    let cleanRef = rawRef.replace(/ref:?\s*/i, '').trim().toUpperCase();
    await handleEditRefSelection(ctx, chatId, cleanRef);
});

async function handleEditRefSelection(ctx, chatId, cleanRef) {
    try {
        let check = await pool.query("SELECT * FROM products WHERE UPPER(ref) = $1", [cleanRef]);
        if (check.rows.length === 0) {
            return ctx.reply(`❌ រកមិនឃើញទំនិញ Ref ${cleanRef} ក្នុងប្រព័ន្ធឡើយ!`);
        }
        let prod = check.rows[0];

        userStates[chatId] = { action: 'CHANGE', step: 'SELECT_FIELD', data: { ref: cleanRef } };

        let msg = `⚙️ **កែប្រែទំនិញ Ref : ${cleanRef}**\n`;
        msg += `• ឈ្មោះ: ${prod.title_km}\n`;
        msg += `• តម្លៃ: $${prod.price}\n\n`;
        msg += `សូមជ្រើសរើសផ្នែកដែលចង់កែប្រែខាងក្រោម៖`;

        await ctx.reply(msg, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: ' កែប្រែឈ្មោះ (Title)', callback_data: `edit_f_title_${cleanRef}` }],
                    [{ text: ' កែប្រែតម្លៃ (Price)', callback_data: `edit_f_price_${cleanRef}` }],
                    [{ text: ' កែប្រែការបរិយាយ (Description)', callback_data: `edit_f_desc_${cleanRef}` }],
                    [{ text: ' កែប្រែវីដេអូ (Video)', callback_data: `edit_f_video_${cleanRef}` }],
                    [{ text: ' កែប្រែភេទ (Gender)', callback_data: `edit_f_gender_${cleanRef}` }],
                    [{ text: ' បោះបង់ (Cancel)', callback_data: 'edit_f_cancel' }]
                ]
            }
        });
    } catch (err) {
        ctx.reply(`❌ មានបញ្ហាស្វែងរកទំនិញ: ${err.message}`);
    }
}

bot.action(/^edit_f_(title|price|desc|video|gender|cancel)_(.+)$/, async (ctx) => {
    let field = ctx.match[1];
    let ref = ctx.match[2];
    let chatId = ctx.chat.id;

    if (field === 'cancel') {
        delete userStates[chatId];
        await ctx.answerCbQuery('❌ បានបោះបង់ការកែប្រែ');
        return ctx.editMessageText('❌ បានលុបចោលដំណើរការកែប្រែរួចរាល់។');
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
    if (field === 'title') promptText = ` សូមសរសេរឈ្មោះទំនិញថ្មីសម្រាប់ Ref ${ref}:`;
    else if (field === 'price') promptText = ` សូមសរសេរតម្លៃថ្មីជាតួលេខសម្រាប់ Ref ${ref} (ឧ. 15.00):`;
    else if (field === 'desc') promptText = ` សូមសរសេរការបរិយាយថ្មីសម្រាប់ Ref ${ref}:`;
    else if (field === 'video') promptText = ` សូម Upload Video ថ្មីសម្រាប់ Ref ${ref}:`;

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
        await ctx.editMessageText(`✅ ជោគជ័យ! ទំនិញ Ref ${ref} ត្រូវបានកែប្រែភេទជា (${gender === 'men' ? 'Men (បុរស)' : 'Women (នារី)'}) រួចរាល់។\n\n🌐 Website នឹងធ្វើបច្ចុប្បន្នភាពស្វ័យប្រវត្តិ។`);
    } catch (err) {
        await ctx.answerCbQuery('❌ មានបញ្ហា');
        await ctx.editMessageText(`❌ បរាជ័យក្នុងការកែប្រែ: ${err.message}`);
    }
});

// 4. មុខងារលុបទំនិញ និងរំកិលលេខ Ref ស្វ័យប្រវត្តិ (ឧ. /deleteref7)
bot.hears(/^\/deleteref(.+)/i, async (ctx) => {
    let chatId = ctx.chat.id;
    await registerAdmin(chatId);
    let rawRef = ctx.match[1].trim();
    let cleanRef = rawRef.replace(/ref:?\s*/i, '').trim().toUpperCase();

    if (!cleanRef) {
        return ctx.reply('⚠️ សូមระบุលេខកូដទំនិញដែលចង់លុបឱ្យបានត្រឹមត្រូវ (ឧ. /deleteref7)');
    }

    try {
        let check = await pool.query("SELECT * FROM products WHERE UPPER(ref) = $1", [cleanRef]);
        if (check.rows.length === 0) {
            return ctx.reply(`❌ រកមិនឃើញទំនិញ Ref ${cleanRef} ក្នុងប្រព័ន្ធឡើយ!`);
        }

        let deletedNum = parseInt(cleanRef);

        await pool.query("DELETE FROM stock WHERE UPPER(ref) = $1", [cleanRef]);
        await pool.query("DELETE FROM products WHERE UPPER(ref) = $1", [cleanRef]);

        if (!isNaN(deletedNum)) {
            let allProds = await pool.query("SELECT ref FROM products ORDER BY CAST(ref AS INTEGER) ASC");
            
            for (let row of allProds.rows) {
                let currentNum = parseInt(row.ref);
                if (!isNaN(currentNum) && currentNum > deletedNum) {
                    let newNum = currentNum - 1;
                    await pool.query("UPDATE products SET ref = $1 WHERE ref = $2", [String(newNum), row.ref]);
                    await pool.query("UPDATE stock SET ref = $1 WHERE ref = $2", [String(newNum), row.ref]);
                }
            }
        }

        ctx.reply(`🗑️ ជោគជ័យ! លុប Ref ${cleanRef} និងបានរំកិលលេខ Ref ផ្សេងទៀតក្នុងប្រព័ន្ធរួចរាល់ហើយ។\n\n🌐 Website នឹងធ្វើបច្ចុប្បន្នភាពស្វ័យប្រវត្តិ។`);
    } catch (err) {
        ctx.reply(`❌ បរាជ័យក្នុងការលុบทំនិញ: ${err.message}`);
    }
});

bot.action(/^confirm_order_(.+)$/, async (ctx) => {
    let orderId = ctx.match[1];
    try {
        await pool.query("UPDATE orders SET status = 'CONFIRMED' WHERE id = $1", [orderId]);
        await ctx.answerCbQuery('✅ បានបញ្ជាក់ការកុម្មង់រួចរាល់!');
        let originalText = ctx.callbackQuery.message.text;
        await ctx.editMessageText(originalText + '\n\nstatus: ✅ Confirmed (បានបញ្ជាក់ការកុម្មង់)', {
            reply_markup: { inline_keyboard: [] }
        });
    } catch (err) {
        await ctx.answerCbQuery('❌ មានបញ្ហា: ' + err.message);
    }
});

bot.action(/^cancel_order_(.+)$/, async (ctx) => {
    let orderId = ctx.match[1];
    try {
        let orderRes = await pool.query("SELECT * FROM orders WHERE id = $1", [orderId]);
        if (orderRes.rows.length === 0) {
            return ctx.answerCbQuery('❌ រកមិនឃើញព័ត៌មានកុម្មង់នេះទេ!');
        }
        let order = orderRes.rows[0];
        if (order.status === 'CANCELLED') {
            return ctx.answerCbQuery('⚠️ ការកុម្មង់នេះត្រូវបានលុបចោលរួចហើយ!');
        }

        let items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;

        for (let key in items) {
            let item = items[key];
            let cleanRef = String(item.ref).replace(/ref:?\s*/i, '').trim().toUpperCase();
            let cleanSize = String(item.size).trim().toUpperCase();
            let qty = parseInt(item.qty) || 0;

            await pool.query(
                "UPDATE stock SET stock_qty = stock_qty + $1 WHERE UPPER(ref) = $2 AND UPPER(size) = $3",
                [qty, cleanRef, cleanSize]
            );
        }

        await pool.query("UPDATE orders SET status = 'CANCELLED' WHERE id = $1", [orderId]);
        await ctx.answerCbQuery('❌ បានបដិសេធ និងសងស្តុកចូលវិញជោគជ័យ!');
        let originalText = ctx.callbackQuery.message.text;
        await ctx.editMessageText(originalText + '\n\nstatus: ❌ Cancelled & Stock Restored (បដិសេធ និងសងស្តុកចូលស្តុកវិញរួចរាល់)', {
            reply_markup: { inline_keyboard: [] }
        });
    } catch (err) {
        await ctx.answerCbQuery('❌ មានបញ្ហា: ' + err.message);
    }
});

bot.action(/^gender_(.+)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    if (!userStates[chatId] || userStates[chatId].step !== 'GENDER') return;

    let gender = ctx.match[1];
    userStates[chatId].data.gender = gender;
    userStates[chatId].step = 'TYPE';

    await ctx.answerCbQuery();
    await ctx.editMessageText(`🚻 ប្រភេទភេទដែលបានជ្រើសរើស: ${gender === 'men' ? 'Men (បុរស)' : 'Women (នារី)'}`);
    await ctx.reply('សូមបញ្ជាក់ប្រភេទ (សូមជ្រើសរើសប៊ូតុងខាងក្រោម):', {
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
    await ctx.editMessageText(`🏷️ ប្រភេទដែលបានជ្រើសរើស: ${type}`);

    try {
        let cleanRef = String(state.data.ref).trim().toUpperCase();
        let parsedPrice = parseFloat(state.data.price) || 0;

        await pool.query(
            `INSERT INTO products (ref, title_km, desc_km, gender, type, video_url, price) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             ON CONFLICT (ref) DO UPDATE 
             SET title_km = $2, desc_km = $3, gender = $4, type = $5, video_url = $6, price = $7`,
            [cleanRef, state.data.title_km, state.data.desc_km || '', state.data.gender || 'men', state.data.type || 'tops', state.data.video_url || '', parsedPrice]
        );

        if (state.action === 'ADD') {
            let sizes = ['S', 'M', 'L', 'XL', 'XXL'];
            for (let size of sizes) {
                await pool.query(
                    `INSERT INTO stock (ref, size, stock_qty, price) 
                     VALUES ($1, $2, $3, $4) 
                     ON CONFLICT (ref, size) DO UPDATE 
                     SET price = $4`,
                    [cleanRef, size, 0, parsedPrice]
                );
            }
        }

        await ctx.reply('សំណើរបានជោគជ័យ 📦');
    } catch (err) {
        await ctx.reply(`❌ បរាជ័យក្នុងការកត់ត្រាចូល Database: ${err.message}`);
    }

    delete userStates[chatId];
});

bot.on('message', async (ctx) => {
    const chatId = ctx.chat.id;
    await registerAdmin(chatId);
    if (!userStates[chatId]) return;
    let state = userStates[chatId];

    await ctx.sendChatAction('typing');

    const msg = ctx.message;
    const text = msg.text || msg.caption || '';
    const RAILWAY_HOST = 'https://control-stock-production-a855.up.railway.app';

    // គ្រប់គ្រងសកម្មភាព CHANGE (កែប្រែទំនិញ)
    if (state.action === 'CHANGE') {
        if (state.step === 'GET_REF') {
            let cleanRef = text.replace(/ref:?\s*/i, '').trim().toUpperCase();
            if (!cleanRef) return ctx.reply('⚠️ សូមបញ្ចូលលេខ Ref ឱ្យបានត្រឹមត្រូវ!');
            delete userStates[chatId];
            return handleEditRefSelection(ctx, chatId, cleanRef);
        }

        let ref = state.data.ref;

        if (state.step === 'UPDATE_TITLE') {
            if (!text.trim()) return ctx.reply('⚠️ សូមបញ្ចូលឈ្មោះទំនិញថ្មី!');
            await pool.query("UPDATE products SET title_km = $1 WHERE UPPER(ref) = $2", [text.trim(), ref]);
            delete userStates[chatId];
            return ctx.reply(`✅ ជោគជ័យ! ទំនិញ Ref ${ref} ត្រូវបានកែប្រែឈ្មោះថ្មីរួចរាល់。\n\n🌐 Website នឹងធ្វើបច្ចុប្បន្នភាពស្វ័យប្រវត្តិ។`);
        }

        if (state.step === 'UPDATE_PRICE') {
            let newPrice = parseFloat(text);
            if (isNaN(newPrice)) return ctx.reply('⚠️ សូមបញ្ចូលតម្លៃជាតួលេខត្រឹមត្រូវ (ឧ. 15.00)');
            await pool.query("UPDATE products SET price = $1 WHERE UPPER(ref) = $2", [newPrice, ref]);
            await pool.query("UPDATE stock SET price = $1 WHERE UPPER(ref) = $2", [newPrice, ref]);
            delete userStates[chatId];
            return ctx.reply(`✅ ជោគជ័យ! ទំនិញ Ref ${ref} ត្រូវបានកែប្រែតម្លៃថ្មី ($${newPrice.toFixed(2)}) រួចរាល់。\n\n🌐 Website នឹងធ្វើបច្ចុប្បន្នភាពស្វ័យប្រវត្តិ។`);
        }

        if (state.step === 'UPDATE_DESC') {
            await pool.query("UPDATE products SET desc_km = $1 WHERE UPPER(ref) = $2", [text.trim(), ref]);
            delete userStates[chatId];
            return ctx.reply(`✅ ជោគជ័យ! ទំនិញ Ref ${ref} ត្រូវបានកែប្រែការបរិយាយថ្មីរួចរាល់。\n\n🌐 Website នឹងធ្វើបច្ចុប្បន្នភាពស្វ័យប្រវត្តិ។`);
        }

        if (state.step === 'UPDATE_VIDEO') {
            let videoUrl = '';
            if (msg.video || msg.video_note || (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('video/'))) {
                try {
                    let fileId = msg.video ? msg.video.file_id : (msg.video_note ? msg.video_note.file_id : msg.document.file_id);
                    let link = await ctx.telegram.getFileLink(fileId);
                    let urlStr = typeof link === 'string' ? link : link.href || link.toString();
                    
                    let response = await fetch(urlStr);
                    let arrayBuffer = await response.arrayBuffer();
                    let buffer = Buffer.from(arrayBuffer);
                    
                    let fileName = `vid_${Date.now()}.mp4`;
                    let filePath = path.join(videoDir, fileName);
                    fs.writeFileSync(filePath, buffer);

                    videoUrl = `${RAILWAY_HOST}/videos/${fileName}`;
                } catch (err) {
                    return ctx.reply(`❌ បរាជ័យក្នុងការទាញយកវីដេអូ: ${err.message}. សុំ Upload Video សារថ្មី។`);
                }
            } else if (text.trim()) {
                let inputUrl = text.trim();
                videoUrl = inputUrl.startsWith('http') ? inputUrl : `${RAILWAY_HOST}/${inputUrl}`;
            } else {
                return ctx.reply('⚠️ សុំ Upload Video ឱ្យបានត្រឹមត្រូវ!');
            }

            await pool.query("UPDATE products SET video_url = $1 WHERE UPPER(ref) = $2", [videoUrl, ref]);
            delete userStates[chatId];
            return ctx.reply(`✅ ជោគជ័យ! ទំនិញ Ref ${ref} ត្រូវបានកែប្រែវីដេអូថ្មីរួចរាល់。\n\n🌐 Website នឹងធ្វើបច្ចុប្បន្នភាពស្វ័យប្រវត្តិ។`);
        }
        return;
    }

    // គ្រប់គ្រងសកម្មភាព ADD (បន្ថែមទំនិញ)
    switch (state.step) {
        case 'TITLE':
            if (!text.trim()) return ctx.reply('⚠️ សរសេរ : បញ្ចូលឈ្មោះទំនិញ');
            state.data.title_km = text.trim();
            state.step = 'PRICE';
            return ctx.reply('សរសេរ : បញ្ចូលតម្លៃទំនិញ');

        case 'PRICE':
            let price = parseFloat(text);
            if (isNaN(price)) return ctx.reply('⚠️ សរសេរ : បញ្ចូលតម្លៃទំនិញ (ជាតួលេខ ឧ. 15.00)');
            state.data.price = price;
            state.step = 'DESC';
            return ctx.reply('សូមសរសេរការបរិយាយពីទំនិញ !');

        case 'DESC':
            state.data.desc_km = text.trim();
            state.step = 'VIDEO';
            return ctx.reply('សុំ Upload Video');

        case 'VIDEO':
            let videoUrl = '';
            if (msg.video || msg.video_note || (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('video/'))) {
                try {
                    let fileId = msg.video ? msg.video.file_id : (msg.video_note ? msg.video_note.file_id : msg.document.file_id);
                    let link = await ctx.telegram.getFileLink(fileId);
                    let urlStr = typeof link === 'string' ? link : link.href || link.toString();
                    
                    let response = await fetch(urlStr);
                    let arrayBuffer = await response.arrayBuffer();
                    let buffer = Buffer.from(arrayBuffer);
                    
                    let fileName = `vid_${Date.now()}.mp4`;
                    let filePath = path.join(videoDir, fileName);
                    fs.writeFileSync(filePath, buffer);

                    videoUrl = `${RAILWAY_HOST}/videos/${fileName}`;
                } catch (err) {
                    return ctx.reply(`❌ បរាជ័យក្នុងការទាញយកវីដេអូ: ${err.message}. សុំ Upload Video សារថ្មី។`);
                }
            } else if (text.trim()) {
                let inputUrl = text.trim();
                videoUrl = inputUrl.startsWith('http') ? inputUrl : `${RAILWAY_HOST}/${inputUrl}`;
            } else {
                return ctx.reply('⚠️ សុំ Upload Video ឱ្យបានត្រឹមត្រូវ!');
            }

            state.data.video_url = videoUrl;
            state.step = 'GENDER';
            return ctx.reply('ជ្រើសរើសប្រភេទ ភេទ:', {
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

bot.launch();
console.log('Telegram Bot started successfully...');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
