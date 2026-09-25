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

// បង្កើត Folder videos បើមិនទាន់មាន
const videoDir = path.join(__dirname, 'videos');
if (!fs.existsSync(videoDir)) {
    fs.mkdirSync(videoDir, { recursive: true });
}

// បង្កើត Table ស្តុក និង ផលិតផលស្វ័យប្រវត្តិពេលចាប់ផ្តើម Server
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
            ORDER BY CAST(p.ref AS INTEGER) ASC;
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
        for (let key in items) {
            let item = items[key];
            let cleanRef = item.ref.replace(/ref:?\s*/i, '').trim().toUpperCase();
            let cleanSize = item.size.trim().toUpperCase();
            
            let check = await pool.query(
                "SELECT stock_qty FROM stock WHERE UPPER(ref) = $1 AND UPPER(size) = $2",
                [cleanRef, cleanSize]
            );
            
            if (check.rows.length > 0) {
                let currentStock = check.rows[0].stock_qty;
                if (currentStock < item.qty) {
                    return res.json({ 
                        success: false, 
                        message: `សូមអភ័យទោស! ទំនិញ Ref ${cleanRef} Size ${cleanSize} ស្តុកមិនគ្រប់គ្រាន់ទេ!` 
                    });
                }
            } else {
                return res.json({ success: false, message: `រកមិនឃើញទំនិញ Ref ${cleanRef} Size ${cleanSize} ឡើយ!` });
            }
        }

        for (let key in items) {
            let item = items[key];
            let cleanRef = item.ref.replace(/ref:?\s*/i, '').trim().toUpperCase();
            let cleanSize = item.size.trim().toUpperCase();
            
            await pool.query(
                "UPDATE stock SET stock_qty = stock_qty - $1 WHERE UPPER(ref) = $2 AND UPPER(size) = $3",
                [item.qty, cleanRef, cleanSize]
            );
        }

        res.json({ success: true, message: "ការកុម្មង់បានជោគជ័យ និងកាត់ស្តុកស្វ័យប្រវត្តិរួចរាល់!" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- TELEGRAM BOT COMMANDS & CHAT FLOW ---
bot.command('AddProduct', async (ctx) => {
    const chatId = ctx.chat.id;
    
    try {
        let prodRes = await pool.query("SELECT ref FROM products");
        let maxRef = 0;
        prodRes.rows.forEach(r => {
            let num = parseInt(r.ref);
            if (!isNaN(num) && num > maxRef) maxRef = num;
        });
        let nextRef = String(maxRef + 1);

        userStates[chatId] = { step: 'TITLE', data: { ref: nextRef } };
        ctx.reply(`📦 ចាប់ផ្តើមបន្ថែមទំនិញថ្មី (Ref  অটো: ${nextRef})\n\nសរសេរ : បញ្ចូលឈ្មោះទំនិញ`);
    } catch (err) {
        ctx.reply(`❌ មានបញ្ហាក្នុងការបង្កើត Ref ស្វ័យប្រវត្តិ: ${err.message}`);
    }
});

bot.command('cancel', (ctx) => {
    const chatId = ctx.chat.id;
    if (userStates[chatId]) {
        delete userStates[chatId];
        ctx.reply('❌ បានលុបចោលដំណើរការបន្ថែមទំនិញរួចរាល់។');
    } else {
        ctx.reply('ℹ️ គ្មានដំណើរការណាកំពុងរត់ទេ។');
    }
});

// មុខងារលុបទំនិញ និងរំកិលលេខ Ref ស្វ័យប្រវត្តិ (Auto-Shift)
bot.hears(/^\/deleteref(.+)/i, async (ctx) => {
    let rawRef = ctx.match[1].trim();
    let cleanRef = rawRef.replace(/ref:?\s*/i, '').trim().toUpperCase();

    if (!cleanRef) {
        return ctx.reply('⚠️ សូមระบุលេខកូដទំនិញដែលចង់លុបឱ្យបានត្រឹមត្រូវ (ឧ. /DeleteRef7)');
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

// បង្កើតពាក្យបញ្ជា /admin
bot.command('admin', (ctx) => {
    ctx.reply('🛠️ ចុចប៊ូតុងខាងក្រោមដើម្បីបើក Admin Mini App សម្រាប់គ្រប់គ្រងស្តុកហាង OneDay Clothing:', {
        reply_markup: {
            inline_keyboard: [
                [{ 
                    text: '📂 បើក Admin Mini App', 
                    web_app: { url: 'https://control-stock-production-a855.up.railway.app/admin.html' } 
                }]
            ]
        }
    });
});

// Handle Button Click for Gender Selection
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

// Handle Button Click for Type Selection
bot.action(/^type_(.+)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    if (!userStates[chatId] || userStates[chatId].step !== 'TYPE') return;

    let type = ctx.match[1];
    userStates[chatId].data.type = type;
    userStates[chatId].step = 'STOCK';

    await ctx.answerCbQuery();
    await ctx.editMessageText(`🏷️ ប្រភេទដែលបានជ្រើសរើស: ${type}`);
    await ctx.reply('សូមបញ្ជាក់ចំនួនស្តុកដើម សម្រាប់ Size នីមួយៗ (Auto Default is 0):');
});

// Unified Message Handler (គ្រប់គ្រង Text និង Video Upload)
bot.on('message', async (ctx) => {
    const chatId = ctx.chat.id;
    if (!userStates[chatId]) return;
    let state = userStates[chatId];

    await ctx.sendChatAction('typing');

    const msg = ctx.message;
    const text = msg.text || msg.caption || '';
    const RAILWAY_HOST = 'https://control-stock-production-a855.up.railway.app';

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

        case 'STOCK':
            let stock = parseInt(text);
            let defaultQty = isNaN(stock) ? 0 : stock;
            state.data.initial_stock = defaultQty;
            
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

                await ctx.reply('សំណើរបានជោគជ័យ 📦');
            } catch (err) {
                await ctx.reply(`❌ បរាជ័យក្នុងការកត់ត្រាចូល Database: ${err.message}`);
            }
            
            delete userStates[chatId];
            break;
    }
});

bot.launch();
console.log('Telegram Bot started successfully...');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
