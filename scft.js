(async function() {
  // === 🧩 Kullanıcıdan grup ID al ===
  let targetGroupId = parseInt(prompt("🎯 Scramble botu için grup ID'sini gir:"), 10);
  if (isNaN(targetGroupId)) {
    console.error("❌ Geçerli bir grup ID girilmedi. Bot başlatılmadı.");
    return;
  }
  console.log(`✅ Bot ${targetGroupId} ID'li gruba bağlanacak.`);

  // === 🧠 Kelime listesi ===
  let wordListUrl = "https://raw.githubusercontent.com/clanu5/wo/refs/heads/main/sc.txt";
  let wordList = [];

  async function yasuo() {
    try {
      const response = await fetch(wordListUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const text = await response.text();
      wordList = text
        .split('\n')
        .map(w => w.trim().toLowerCase())
        .filter(w => w.length > 0);
      console.log(`✅ ${wordList.length} kelime yüklendi!`);
    } catch (err) {
      console.error("❌ Wordlist yüklenemedi:", err);
    }
  }

  await yasuo(); // Başlangıçta kelime listesini yükle

  // === 🔡 Scramble çözüm fonksiyonu ===
  function solveScramble(scrambled, wordList) {
    if (!scrambled || scrambled.length < 3) return null;

    const firstChar = scrambled[0].toLowerCase();
    const lastChar = scrambled[scrambled.length - 1].toLowerCase();
    const middleChars = scrambled.slice(1, -1).toLowerCase().split('').sort().join('');

    return wordList.find(word => {
      word = word.toLowerCase().trim();
      if (word.length !== scrambled.length) return false;
      if (word[0] !== firstChar || word[word.length - 1] !== lastChar) return false;

      const middle = word.slice(1, -1).split('').sort().join('');
      return middle === middleChars;
    }) || null;
  }

  // === ⚙️ WOLF bağlantısı ===
  let client = PalringoWebConnection;
  let isListening = false;
  let lastActionTime = Date.now();

  let _sendMessage = (targetId, content, isGroup) => {
    let packet = {
      "body": {
        recipient: targetId,
        isGroup: isGroup,
        mimeType: 'text/plain',
        data: new TextEncoder().encode(content).buffer,
        flightId: Math.random().toString(36).substring(7),
        metadata: undefined,
        embeds: undefined,
      }
    };
    return client.socket.emit('message send', packet);
  };

  let sendGroupMessage = (targetId, content) => _sendMessage(targetId, content, true);

  // ✅ 10 saniye sessizlikte otomatik komut gönder
  setInterval(() => {
    let now = Date.now();
    if (now - lastActionTime >= 10000) {
      sendGroupMessage(targetGroupId, "!scramble next");
      console.warn("⏰ 10 saniye geçti, otomatik komut gönderildi.");
      lastActionTime = now;
    }
  }, 5000);

  // ✅ Sadece bir kere dinleyici tanımla
  if (!isListening) {
    client.socket.on('message send', async function (data) {
      let message = data.body;
      message.text = new TextDecoder().decode(message.data).trim();

      // ✅ SADECE 35920523 ID'li kullanıcıdan gelen scramble mesajları
      const scrambleMatch = message.text.match(/\|\>\s*([a-zA-Z]+)\s*\<\|/);
      if (message.originator === 35920523 && scrambleMatch) {
        const scrambled = scrambleMatch[1].toLowerCase();
        const solution = solveScramble(scrambled, wordList);

        if (solution) {
          console.log(`🎯 Scramble çözüldü: ${solution}`);
          setTimeout(() => {
            sendGroupMessage(targetGroupId, solution);
          }, 1300);
        } else {
          console.log(`❌ Çözüm bulunamadı: ${scrambled}`);
          setTimeout(() => {
            sendGroupMessage(targetGroupId, "!scramble next");
            console.warn("➡️ Yeni kelime istendi: !scramble next");
          }, 2000);
        }

        lastActionTime = Date.now();
      }
    });

    isListening = true;
  }
})();
