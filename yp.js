const { WOLF } = require('wolf.js');
const axios = require('axios'); 
const { createCanvas } = require('canvas'); 
// 1. JSON VERİSİNİ YÜKLEME
const gameData = require('./kim-soru.json'); 
const { URLSearchParams } = require('url');

// --- GÖRSELLEŞTİRME YARDIMCI İŞLEVİ: KELİME KAYDIRMA (WORD WRAPPING) ---
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    let lines = [];
    let currentY = y;

    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;

        if (testWidth > maxWidth && n > 0) {
            lines.push(line);
            line = words[n] + ' ';
        } else {
            line = testLine;
        }
    }
    lines.push(line);

    for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i].trim(), x, currentY);
        currentY += lineHeight;
    }
    return currentY; 
}
// ------------------------------------------------------------------------

// 🎯 SABİTLER
const BOT_OWNER_ID = 72985614;              
const TARGET_GROUP_IDS = [18027948, 13428889, 19184408]; 

// 🔑 API ANAHTARI VE AYARLARI
const GEMINI_API_KEY = "AIzaSyDWhqeixJJo8xJUhmY4nOua3x2DmdFJKLI"; 
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"; 
const MAX_QUESTIONS_PER_USER = 3; // OYUNCU BAŞINA SORU HAKKI

/**
 * Grup bazında oyun durumunu yöneten sınıf.
 */
class GuessingGame {
    constructor(client, groupId, targetItem) {
        this.client = client;
        this.groupId = groupId;
        // targetItem: { isim: "Tarkan", ipucu1: "...", ... }
        this.targetItem = targetItem; 
        this.questionCounts = {}; // { userId: count, ... }
        this.isOver = false;
        this.clueIndex = 1; // Başlangıç ipucu
    }
    
    // Rastgele bir ünlü seçme (şimdilik sadece yerli_unluler kullanılıyor)
    static selectRandomItem() {
        const unluler = gameData.yerli_unluler;
        const randomIndex = Math.floor(Math.random() * unluler.length);
        return unluler[randomIndex];
    }
    
    // Oyun başlangıç mesajını oluşturur
    getStartMessage() {
        const initialClue = this.targetItem[`ipucu${this.clueIndex}`];
        return `
        🎉 **YENİ OYUN BAŞLADI!** 🎉
        
        Aklımdaki kişi/nesne (Gizli!)
        
        **Kategori:** 🇹🇷 YERLİ ÜNLÜ 
        
        **İlk İpucu:** "${initialClue}"
        
        *3 Soru Hakkınız Var:* **!soru <sorunuz>** yazarak ek bilgi isteyin.
        *Tahmin:* **!cevap <tahmininiz>** yazarak yanıtlayın.
        `;
    }
    
    // Yeni ipucu verir, eğer varsa
    getNextClue() {
        this.clueIndex++;
        const clue = this.targetItem[`ipucu${this.clueIndex}`];
        if (clue) {
            return `
            🔔 **Yeni İpucu Geldi!** "${clue}"
            `;
        }
        return `
        ⚠️ **Yeni ipucu yok.** Artık son tahminlerinizi yapın!
        `;
    }
    
    // Kullanıcının soru hakkı var mı kontrol eder ve kullanır
    async useQuestion(userId, nickname) {
        this.questionCounts[userId] = (this.questionCounts[userId] || 0) + 1;
        const remaining = MAX_QUESTIONS_PER_USER - this.questionCounts[userId];
        
        if (remaining < 0) {
            await this.client.messaging.sendMessage(
                this.groupId, 
                `❌ ${nickname}, tüm soru haklarını kullandın! (**${MAX_QUESTIONS_PER_USER}** hak)`
            );
            return false;
        }
        
        return true;
    }
    
    // Kullanıcının kalan soru hakkını döner
    getRemainingQuestions(userId) {
        const used = this.questionCounts[userId] || 0;
        return MAX_QUESTIONS_PER_USER - used;
    }
}

class ClanUsBot {
    constructor() {
        this.client = new WOLF();
        this.messageHistory = {}; 
        this.activeGames = {}; // Grup bazında oyun durumunu tutar
        this.setupEvents();
    }
    
    setupEvents() {
        this.client.on('ready', async () => {
            console.log('✅ Bot başarıyla giriş yaptı!');
            console.log(`🎯 Hedef Grup ID'leri: ${TARGET_GROUP_IDS.join(', ')}`); 
        });

        this.client.on('message', async (message) => {
            await this.handleMessage(message);
        });
        
        this.client.on('error', (error) => { console.error('❌ Bot hatası:', error); });
    }

    async getNickname(userId) {
        try {
            const user = await this.client.subscriber.getById(userId);
            return user.nickname || userId;
        } catch {
            return userId;
        }
    }

    // --- GÖRÜNTÜ OLUŞTURMA İŞLEVİ (CANVAS) ---
    async createAnalysisImage(nickname, analysisText) {
        const width = 800;
        const height = 550; 
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        
        const padding = 40;
        const lineHeight = 35; 
        const maxWidth = width - 2 * padding;
        const bulletOffset = 20; 

        // Arkaplan, Çerçeve
        ctx.fillStyle = '#FFFFFF'; 
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = '#00008B'; 
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, width - 4, height - 4);

        // Başlık
        ctx.font = 'bold 36px Arial';
        ctx.fillStyle = '#00008B'; 
        ctx.fillText(`💬 ${nickname} SOHBET YORUMU`, padding, 70); 
        
        // Analiz Metni
        ctx.font = '24px Arial';
        ctx.fillStyle = '#333333';
        
        const paragraphs = analysisText.split('\n');
        let currentY = 140;

        for (const paragraph of paragraphs) {
            if (paragraph.trim().length > 0) {
                ctx.fillText('•', padding, currentY); 
                
                currentY = wrapText(
                    ctx, 
                    paragraph.trim(), 
                    padding + bulletOffset, 
                    currentY, 
                    maxWidth - bulletOffset, 
                    lineHeight
                );
                currentY += 10; 
            }
        }
        
        return canvas.toBuffer('image/jpeg', { quality: 0.9 }); 
    }

    // --- YAPAY ZEKA API ÇAĞRILARI ---
    
    // Mevcut analiz fonksiyonu (Kullanıcının sohbet analizini yapar)
    async performConversationAnalysis(messages, targetNickname) {
        if (!GEMINI_API_KEY) {
            return "❌ API Anahtarı eksik veya hatalı.";
        }

        if (messages.length === 0) {
            return "❌ Yeterli mesaj verisi bulunamadı.";
        }
        
        const prompt = `
        Aşağıdaki mesajlar, WOLF uygulamasındaki bir grup sohbetinden alınmıştır. Kullanıcı adı: ${targetNickname}. 
        
        Bu mesajları analiz ederek kullanıcının **sohbet içindeki niyetini, tavrını ve genel konuşma dinamiğini** özetleyen EN FAZLA 3 CÜMLE oluştur. 
        
        Analizin tonu **SERT, DOĞRUDAN VE ELEŞTİREL** olmalıdır. Kullanıcının olumsuz yanlarını (örneğin, gereksiz tekrarlar, rahatsız edici ton, konudan sapma) vurgulamaktan çekinme. Analiz, SADECE gerçekleri ve gözlemleri içermelidir, hakaret içermemelidir. Her cümleyi mutlaka ayrı bir satıra yaz. Kesinlikle ek bir başlık veya giriş cümlesi kullanma.
        
        --- MESAJLAR ---
        ${messages.join('\n- ')}
        `;
        
        try {
            const response = await axios.post(
                `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, 
                { contents: [{ role: "user", parts: [{ text: prompt }] }] }
            );
            
            return response.data.candidates[0].content.parts[0].text;

        } catch (error) {
            console.error('❌ API Çağrısı Hatası (Analiz):', error.response ? error.response.data : error.message);
            return `❌ Yapay Zeka servisiyle iletişim kurulurken bir hata oluştu (Analiz). Lütfen konsolu kontrol edin.`;
        }
    }
    
    // Yeni Soru-Cevap fonksiyonu (Tahmin Oyunu için)
    async performGameQuestion(targetItem, playerQuestion) {
        if (!GEMINI_API_KEY) {
            return "❌ API Anahtarı eksik veya hatalı.";
        }

        const personInfo = JSON.stringify(targetItem);
        
        const prompt = `
        Senin aklındaki kişi Türk ünlüsü: ${targetItem.isim}. 
        Kişinin bilgileri: ${personInfo}.
        
        Bir oyuncu sana şu soruyu sordu: "${playerQuestion}". 
        
        1. Bu soruya **KİŞİNİN GERÇEK HAYAT BİLGİLERİNE UYGUN, KISA ve TEK CÜMLELİK** bir cevap ver. 
        2. Cevabın, tahmin edilen ismin ipuçlarına veya popüler bilgilerine dayanmalı, ancak ismi AÇIKÇA vermemelidir.
        3. Sorunun alakasız veya çok kişisel/bilinmeyen bir bilgi istemesi durumunda kibarca "Bu bilgiyi paylaşamam" veya "Bu konuda kesin bir bilgi yok" şeklinde yanıtla.
        4. Cevabın Tonu **KİBAR VE OYUNU DESTEKLEYİCİ** olmalıdır.
        5. Sadece cevabı yaz, ek açıklama yapma.
        `;
        
        try {
            const response = await axios.post(
                `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, 
                { contents: [{ role: "user", parts: [{ text: prompt }] }] }
            );
            
            return response.data.candidates[0].content.parts[0].text.trim();

        } catch (error) {
            console.error('❌ API Çağrısı Hatası (Oyun):', error.response ? error.response.data : error.message);
            return `❌ Yapay Zeka servisiyle iletişim kurulurken bir hata oluştu (Oyun).`;
        }
    }


    async handleMessage(message) {
        try {
            if (message.isFromClient || !message.body || !message.isGroup || !TARGET_GROUP_IDS.includes(message.targetGroupId)) return;
            
            const text = message.body.trim(); 
            const textLower = text.toLowerCase();
            const groupId = message.targetGroupId;
            const userId = message.sourceSubscriberId; 
            const nickname = await this.getNickname(userId);
            
            
            // 1. MESAJ GEÇMİŞİNİ KAYDETME (Analiz için)
            if (!text.startsWith('!')) {
                 if (!this.messageHistory[userId]) {
                     this.messageHistory[userId] = [];
                 }
                 this.messageHistory[userId].push(text);
                 if (this.messageHistory[userId].length > 50) {
                     this.messageHistory[userId].shift(); 
                 }
            }
            
            // 2. YETKİLİ KOMUT - !bot g <id> 
            const botGMatch = textLower.match(/^!bot\s+g\s+(\d+)$/);
            if (botGMatch && userId === BOT_OWNER_ID) { 
                 const targetGroupId = parseInt(botGMatch[1]);
                 try {
                     await this.client.channel.joinById(targetGroupId);
                     await message.reply(`✅ Bot, **${targetGroupId}** ID'li gruba başarıyla katıldı!`);
                 } catch (error) {
                     await message.reply(`❌ HATA: Gruba katılamadı. Sebep: ${error.message}`);
                 }
                 return; 
            }
            
            // 3. YAPAY ZEKA ANALİZ KOMUTU (!yapay <kişi id>)
            const yapayMatch = textLower.match(/^!yapay\s+(\d+)$/);
            if (yapayMatch) {
                const targetUserId = parseInt(yapayMatch[1]);
                
                const targetMessages = this.messageHistory[targetUserId] || [];
                const targetNickname = await this.getNickname(targetUserId);

                if (targetMessages.length < 5) {
                     return message.reply(`❌ **${targetNickname}** (${targetUserId}) için yeterli veri yok. Analiz için en az 5 mesaj gerekli (şu an: ${targetMessages.length}).`);
                }

                const analysisResult = await this.performConversationAnalysis(targetMessages, targetNickname);
                const imageBuffer = await this.createAnalysisImage(targetNickname, analysisResult);

                await this.client.messaging.sendMessage(
                    message, 
                    imageBuffer, 
                    'image/jpeg' 
                );

                return;
            }
            
            // --- YENİ OYUN KOMUTLARI ---
            
            // 4. OYUN BAŞLATMA KOMUTU (!kim başlat)
            if (textLower === '!kim başlat' || textLower === '!kimbaşlat') {
                if (this.activeGames[groupId] && !this.activeGames[groupId].isOver) {
                    return message.reply(`⚠️ Bu grupta zaten bir oyun devam ediyor! Önce **!kim bitir** komutu ile sonlandırın.`);
                }
                
                const targetItem = GuessingGame.selectRandomItem();
                this.activeGames[groupId] = new GuessingGame(this.client, groupId, targetItem);
                
                return message.reply(this.activeGames[groupId].getStartMessage());
            }
            
            // 5. OYUN BİTİRME KOMUTU (!kim bitir)
            if (textLower === '!kim bitir' || textLower === '!kimbitir') {
                 if (!this.activeGames[groupId]) {
                     return message.reply(`⚠️ Bu grupta zaten bir oyun başlamamış.`);
                 }
                 
                 const answer = this.activeGames[groupId].targetItem.isim;
                 this.activeGames[groupId].isOver = true;
                 delete this.activeGames[groupId];
                 return message.reply(`❌ Oyun sonlandırıldı. Doğru cevap: **${answer}**`);
            }
            
            const game = this.activeGames[groupId];
            if (!game || game.isOver) return;

            // 6. SORU SORMA KOMUTU (!soru <metin>)
            const soruMatch = textLower.match(/^!soru\s+(.+)$/);
            if (soruMatch) {
                const playerQuestion = soruMatch[1].trim();
                
                // Soru hakkını kontrol et ve kullan
                if (!await game.useQuestion(userId, nickname)) {
                    return; 
                }

                const remaining = game.getRemainingQuestions(userId);
                
                // Yapay Zeka ile soruyu yanıtla
                const aiAnswer = await this.performGameQuestion(game.targetItem, playerQuestion);

                let responseText = `
                👤 **${nickname}**'nin sorusu: *"${playerQuestion}"*
                
                🤖 **Bot'un Cevabı:**
                ${aiAnswer}
                
                ${nickname}, Kalan Soru Hakkın: **${remaining}**
                `;
                
                // Soru hakkı bittiğinde ek ipucu ver (Oyuna dinamizm katar)
                if (game.questionCounts[userId] === MAX_QUESTIONS_PER_USER && remaining === 0) {
                     responseText += `\n\n${game.getNextClue()}`;
                }

                return message.reply(responseText);
            }

            // 7. TAHMİN ETME KOMUTU (!cevap <tahmin>)
            const cevapMatch = textLower.match(/^!cevap\s+(.+)$/);
            if (cevapMatch) {
                const playerGuess = cevapMatch[1].trim();
                const actualAnswer = game.targetItem.isim;
                
                // Karşılaştırma: Büyük/küçük harf ve boşlukları yok sayarak
                const isCorrect = playerGuess.toLowerCase().replace(/\s/g, '') === actualAnswer.toLowerCase().replace(/\s/g, '');

                if (isCorrect) {
                    game.isOver = true;
                    delete this.activeGames[groupId]; // Oyunu bitir ve sil

                    return message.reply(`
                    🏆 **DOĞRU CEVAP!** 🏆
                    
                    Tebrikler **${nickname}**! Doğru Tahmin: **${actualAnswer}**
                    
                    Yeni bir oyun başlatmak için **!kim başlat** yazabilirsin.
                    `);
                } else {
                    return message.reply(`
                    ❌ **YANLIŞ TAHMİN!**
                    
                    **${nickname}**'nin tahmini: *"${playerGuess}"*
                    
                    Maalesef doğru değil. Başka bir oyuncu soru sorabilir veya tahmin yapabilir!
                    `);
                }
            }

        } catch (error) {
            console.error('Mesaj işleme hatası:', error);
        }
    }

    async startBot() {
        try {
            const EMAIL = 'clanus600@gmail.com'; 
            const PASSWORD = 'yasuo123';
            await this.client.login(EMAIL, PASSWORD);
        } catch (error) {
            console.error('❌ Giriş hatası:', error.message);
            // 10 saniye sonra tekrar dene
            setTimeout(() => this.startBot(), 10000);
        }
    }
}

async function main() {
    console.log('=================================');
    console.log('🤖 ClanUs AI Analiz ve Oyun Botu (Kim/Ne Bilmecesi Aktif)');
    console.log('=================================');
    const bot = new ClanUsBot();
    await bot.startBot();
}

process.on('unhandledRejection', (error) => { console.error('❌ İşlenmeyen hata:', error); });
process.on('uncaughtException', (error) => { console.error('❌ Yakalanmayan hata:', error); });
main().catch(error => { console.error('❌ Bot başlatma hatası:', error); });
