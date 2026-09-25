// --- TELEGRAM BOT CHAT FLOW (/AddProduct & /cancel) ---
bot.command('AddProduct', (ctx) => {
    const chatId = ctx.chat.id;
    userStates[chatId] = { step: 'REF', data: {} };
    ctx.reply('📦 ចាប់ផ្តើមបន្ថែមទំនិញថ្មី!\n\nសូមផ្ញើ **លេខកូដទំនិញ (Ref)** មក (ឧ. 7):\n*(បើចង់បោះបង់ សូមវាយ /cancel)*', { parse_mode: 'Markdown' });
});

// ពាក្យបញ្ជាសម្រាប់បោះបង់ដំណើរការពេលទាក់គាំង
bot.command('cancel', (ctx) => {
    const chatId = ctx.chat.id;
    if (userStates[chatId]) {
        delete userStates[chatId];
        ctx.reply('❌ បានលុបចោលដំណើរការបន្ថែមទំនិញរួចរាល់។ សូមវាយ /AddProduct ម្តងទៀតដើម្បីចាប់ផ្តើមសាថ្មី។');
    } else {
        ctx.reply('ℹ️ គ្មានដំណើរការណាកំពុងរត់ទេ។');
    }
});

bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text.trim();
    
    if (!userStates[chatId]) return;
    let state = userStates[chatId];

    // បង្ហាញសញ្ញា Typing ឱ្យដឹងថា Bot កំពុងដំណើរការ ការពារកុំឱ្យអតិថិជនវាយសរសេរជាន់គ្នា
    await ctx.sendChatAction('typing');

    switch (state.step) {
        case 'REF':
            state.data.ref = text;
            state.step = 'TITLE';
            ctx.reply('✍️ សូមបញ្ចូល **ឈ្មោះទំនិញ** (Title):', { parse_mode: 'Markdown' });
            break;

        case 'TITLE':
            state.data.title_km = text;
            state.step = 'PRICE';
            ctx.reply('💵 សូមបញ្ចូល **តម្លៃជាដុល្លារ** (ឧ. 15.00):', { parse_mode: 'Markdown' });
            break;

        case 'PRICE':
            state.data.price = parseFloat(text) || 0;
            state.step = 'DESC';
            ctx.reply('📝 សូមសរសេរ **ការបរិយាយ** ពីទំនិញ (Description):', { parse_mode: 'Markdown' });
            break;

        case 'DESC':
            state.data.desc_km = text;
            state.step = 'VIDEO';
            ctx.reply('🎬 សូមផ្ញើ **Link វីដេអូ** (ឧ. videos/your_video.mp4):', { parse_mode: 'Markdown' });
            break;

        case 'VIDEO':
            state.data.video_url = text;
            state.step = 'GENDER';
            ctx.reply('🚻 សូមជ្រើសរើសប្រភេទភេទ (វាយបញ្ចូលคำថា **men** ឬ **women**):', { parse_mode: 'Markdown' });
            break;

        case 'GENDER':
            state.data.gender = text.toLowerCase();
            state.step = 'TYPE';
            ctx.reply('🏷️ សូមបញ្ជាក់ប្រភេទ (ឧ. **tops** សម្រាប់អាវ, **pants** សម្រាប់ខោ):', { parse_mode: 'Markdown' });
            break;

        case 'TYPE':
            state.data.type = text.toLowerCase();
            state.step = 'STOCK';
            ctx.reply('📦 សូមបញ្ជាក់ **ចំនួនស្តុកដើម** សម្រាប់ Size នីមួយៗ (ឧ. 20):', { parse_mode: 'Markdown' });
            break;

        case 'STOCK':
            state.data.initial_stock = parseInt(text) || 10;
            
            try {
                let cleanRef = String(state.data.ref).replace(/ref:?\s*/i, '').trim().toUpperCase();
                let parsedPrice = parseFloat(state.data.price) || 0;
                let defaultQty = state.data.initial_stock;

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

                ctx.reply(`✅ **ជោគជ័យ!** ទំនិញ Ref ${cleanRef} ត្រូវបានបន្ថែមចូលប្រព័ន្ធ និងបង្កើតស្តុក Size (S, M, L, XL, XXL) រួចរាល់!\n\n🌐 Website នឹង Detect ឃើញទំនិញនេះភ្លាមៗ។`, { parse_mode: 'Markdown' });
            } catch (err) {
                ctx.reply(`❌ បរាជ័យក្នុងការកត់ត្រាចូល Database: ${err.message}`);
            }
            
            delete userStates[chatId];
            break;
    }
});
